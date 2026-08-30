<script>
  import { onMount } from "svelte";
  import { base } from "$app/paths";
  import DataQuality from "../components/DataQuality.svelte";
  import CityMap from "../components/Map.svelte";
  import RouteSummary from "../components/RouteSummary.svelte";
  import ShadeSlider from "../components/ShadeSlider.svelte";
  import SunDial from "../components/SunDial.svelte";
  import TimeSlider from "../components/TimeSlider.svelte";
  import { sunExposure, walked, weights } from "$lib/cost.js";
  import { loadCity, loadManifest, nodePoints, routeGeoJSON } from "$lib/load.js";
  import { SHADE_STEPS, shadeBuckets } from "$lib/overlay.js";
  import { adjacency, astar, nearestNode, scratch } from "$lib/router.js";
  import { isNight, sunPosition } from "$lib/solar.js";
  import { app } from "$lib/stores.svelte.js";

  let cities = $state([]);
  let key = $state(null);
  let error = $state(null);
  let busy = $state(false);

  // $state.raw, not $state. A loaded city is megabytes of typed arrays and the
  // plain objects holding them, replaced wholesale and never mutated in place,
  // so deep-proxying it costs on every read and buys nothing. It also breaks
  // the worker outright: `samples` is a plain object, a proxy of one cannot be
  // structured-cloned, and postMessage throws "could not be cloned".
  let city = $state.raw(null);

  const tz = $derived(city?.meta.timezone ?? "UTC");
  const sun = $derived(
    city ? sunPosition(app.when, city.meta.center[1], city.meta.center[0]) : null,
  );

  // The shade tier of roadmap Section 1.2, driven from here. Only one pass is
  // ever in flight: dragging the slider produces far more sun positions than a
  // city-sized recompute can answer, and all but the last are already stale.
  // $state so that seeding the scene waits for the worker rather than racing
  // the mount that creates it.
  let worker = $state(null);
  let scene = null;
  let seeded = false;
  let running = false;
  let again = false;
  let seq = 0;

  // Dragging the clock across a city the size of Tbilisi asks for a pass a
  // second, and a full one costs the better part of one. So a moving slider
  // gets a strided preview sized to a budget, and the exact pass follows once
  // it stops. The preview is Section 5.2's estimator at a coarser spacing, not
  // a different calculation, and the panel says which one is on screen.
  const SAMPLE_BUDGET = 320_000;
  const SETTLE_MS = 260;

  let stride = 1;
  let settle = null;

  function send(exact = false) {
    if (!worker || !seeded || !sun) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    seq += 1;
    worker.postMessage({ sun: { alt: sun.alt, azi: sun.azi }, seq, stride: exact ? 1 : stride });
  }

  function receive({ data }) {
    if (data.ready) {
      seeded = true;
      send();
      return;
    }

    running = false;
    if (data.seq === seq) {
      let total = 0;
      for (const v of data.sigma) total += v;
      app.shade = {
        sigma: data.sigma,
        ms: data.ms,
        mean: total / data.sigma.length,
        exact: data.stride === 1,
      };
    }
    if (again) {
      again = false;
      send();
    }
  }

  onMount(() => {
    worker = new Worker(new URL("../workers/shade.worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = receive;
    return () => worker.terminate();
  });

  // A new city is a new scene: the index and the sample points both belong to
  // it, so the worker is re-seeded before any sun is sent.
  $effect(() => {
    if (!worker || !city || scene === city.meta.city) return;
    scene = city.meta.city;
    // Nothing in flight belongs to this city, and no sun is sent until the
    // worker acknowledges the scene, so the first pass is not computed twice.
    // The bump is what makes a pass still running for the previous city land
    // as stale rather than as this city's answer.
    seeded = false;
    seq += 1;
    app.shade = null;
    running = false;
    again = false;
    // A preview costs about what a full pass costs divided by the stride, so
    // the stride is whatever keeps the work bounded on this city. Small cities
    // land on 1 and never take a coarse pass at all.
    const points = city.samples.offset[city.graph.u.length];
    stride = Math.max(1, Math.ceil(points / SAMPLE_BUDGET));

    const { height, polygonOffset, ringOffset, x, y } = city.buildings;
    worker.postMessage({
      scene: { buildings: { height, polygonOffset, ringOffset, x, y }, samples: city.samples },
    });
  });

  // The sun moved. Preview now, exact when the slider has been still a moment.
  $effect(() => {
    sun;
    send();
    clearTimeout(settle);
    settle = setTimeout(() => send(true), SETTLE_MS);
  });

  // The cost tier. Built once per city, then reused: the weights array and the
  // search scratch are allocated here so that a slider move writes into them
  // rather than allocating a city's worth of memory per frame.
  //
  // $state.raw, and not a plain variable: the search below has to re-run when
  // this appears, and it would not be told about a variable. Raw because the
  // value is a bag of typed arrays replaced wholesale, and deep-proxying it
  // would buy nothing and cost on every read.
  let routing = $state.raw(null);

  $effect(() => {
    if (!city) {
      routing = null;
      return;
    }
    const view = adjacency(city.graph);
    routing = {
      view,
      work: scratch(view),
      cost: new Float32Array(city.graph.u.length),
      base: new Float32Array(city.graph.u.length),
    };
    app.from = null;
    app.to = null;
    app.route = null;
  });

  function pick(lon, lat) {
    if (!city) return;
    const [px, py] = city.frame.forward(lon, lat);
    const node = nearestNode(city.graph.x, city.graph.y, px, py);
    if (app.from === null || app.to !== null) {
      app.from = node;
      app.to = null;
    } else {
      app.to = node;
    }
  }

  // Section 6.2's closing note, made structural: this reads sigma but never
  // asks for it again, so moving the shade slider re-weights and re-searches
  // without waking the worker.
  $effect(() => {
    const { shade, w, from, to } = app;
    if (!routing || !shade || from === null || to === null || from === to) {
      app.route = null;
      return;
    }

    const { length, x, y } = city.graph;
    const started = performance.now();

    weights(length, shade.sigma, w, routing.cost);
    const found = astar(routing.view, routing.cost, x, y, from, to, routing.work);

    // The same search at w = 0, which is the shortest path by definition. The
    // detour has to be measured against something, and Section 6.1's reading
    // of w is a comparison with exactly this route.
    weights(length, shade.sigma, 0, routing.base);
    const plain = astar(routing.view, routing.base, x, y, from, to, routing.work);

    const elapsed = performance.now() - started;

    app.route = found && {
      edges: found.edges,
      nodes: found.nodes,
      metres: walked(found.edges, length),
      sun: sunExposure(found.edges, length, shade.sigma),
      baseMetres: walked(plain.edges, length),
      baseSun: sunExposure(plain.edges, length, shade.sigma),
      ms: elapsed,
    };
  });

  const routeLine = $derived(app.route ? routeGeoJSON(city.graph, app.route.edges) : null);
  const endPoints = $derived(
    city ? nodePoints(city.graph, [app.from, app.to].filter((n) => n !== null)) : null,
  );

  // Re-sorts pointers into the coordinate arrays built at load; it copies no
  // geometry, so it rides along with each shade pass rather than costing one.
  const shadeLines = $derived(
    city && app.shade ? shadeBuckets(city.streets.coordinates, app.shade.sigma) : null,
  );

  onMount(async () => {
    try {
      cities = await loadManifest(fetch, base);
      if (cities.length > 0) await select(cities[0].city);
    } catch (cause) {
      error = `${cause.message}. Run \`uv run dracool mini\` in pipeline/ first.`;
    }
  });

  async function select(next) {
    key = next;
    busy = true;
    error = null;
    try {
      city = await loadCity(fetch, next, base);
    } catch (cause) {
      error = cause.message;
      city = null;
    } finally {
      busy = false;
    }
  }

  const ms = (value) => `${value.toFixed(0)} ms`;

  // On a phone the panel is a bottom sheet over the map, so everything past
  // the controls and the route folds away. On a wide screen there is room for
  // all of it and it starts open.
  let open = $state(true);
</script>

<CityMap {city} shade={shadeLines} route={routeLine} ends={endPoints} onpick={pick} />

<aside class:open>
  <header>
    <h1>DraCool</h1>
    <button
      type="button"
      aria-expanded={open}
      aria-controls="panel-more"
      onclick={() => (open = !open)}
    >
      {open ? "Less" : "More"}
    </button>
  </header>

  {#if cities.length > 1}
    <select value={key} onchange={(event) => select(event.currentTarget.value)}>
      {#each cities as entry (entry.city)}
        <option value={entry.city}>{entry.display_name}</option>
      {/each}
    </select>
  {/if}

  {#if error}
    <p class="error">{error}</p>
  {:else if busy || !city}
    <p>Loading…</p>
  {:else}
    <TimeSlider {tz} bind:when={app.when} />
    <ShadeSlider bind:w={app.w} />

    {#if app.route}
      <RouteSummary route={app.route} night={isNight(sun)} />
    {:else}
      <p class="note">
        {#if app.from === null}
          Click the map to set a start.
        {:else if app.to === null}
          Click again to set a finish.
        {:else if !app.shade}
          Waiting on the first shade pass.
        {:else if app.from === app.to}
          Both ends snapped to the same junction.
        {:else}
          No path between those points.
        {/if}
      </p>
    {/if}

    <div id="panel-more" class="more" hidden={!open}>
      <hr />

      <SunDial {sun} />

      <hr />

      <h2>Shade</h2>
    <!-- A legend, because the overlay carries its meaning in colour and a
         reader who cannot recover the scale is looking at decoration. -->
    <div class="ramp">
      {#each SHADE_STEPS as step (step.color)}
        <span style:background={step.color} style:height="{3 + step.width * 2}px"></span>
      {/each}
    </div>
    <div class="ends"><span>all sun</span><span>all shade</span></div>

    <dl>
      <dt>network in shade</dt>
      <dd>{app.shade ? `${(app.shade.mean * 100).toFixed(1)}%` : "…"}</dd>
    </dl>

    <!-- A coarse pass is a real answer to a coarser question, so it is labelled
         rather than passed off as the settled one. -->
    {#if app.shade && !app.shade.exact}
      <p class="note">Preview while the clock moves; refining…</p>
    {/if}

    <hr />

    <DataQuality provenance={city.meta.height_provenance} />

    <details>
      <summary>Timings</summary>
      <dl>
        <dt>nodes</dt>
        <dd>{city.meta.counts.nodes.toLocaleString()}</dd>
        <dt>edges</dt>
        <dd>{city.meta.counts.edges.toLocaleString()}</dd>
        <dt>buildings</dt>
        <dd>{city.meta.counts.buildings.toLocaleString()}</dd>
        <dt>load</dt>
        <dd>{ms(city.timings.total)}</dd>
        <dt>σ pass</dt>
        <dd>{app.shade ? ms(app.shade.ms) : "…"}</dd>
        <dt>route</dt>
        <dd>{app.route ? ms(app.route.ms) : "…"}</dd>
        </dl>
      </details>
    </div>
  {/if}
</aside>

<style>
  :global(body) {
    margin: 0;
    font: 13px/1.5 ui-sans-serif, system-ui, sans-serif;
  }

  aside {
    position: absolute;
    z-index: 1;
    top: 12px;
    left: 12px;
    width: 232px;
    max-height: calc(100dvh - 24px);
    overflow-y: auto;
    padding: 12px 14px;
    border-radius: 6px;
    background: rgb(255 255 255 / 0.92);
    box-shadow: 0 1px 6px rgb(0 0 0 / 0.2);
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }

  h1 {
    margin: 0;
    font-size: 15px;
  }

  /* At least 44px of touch target, which is the smallest a thumb reliably
     hits, without making it loom on a desktop pointer. */
  header button {
    min-height: 32px;
    padding: 4px 10px;
    border: 1px solid #d6d3cd;
    border-radius: 6px;
    background: #ffffff;
    font: inherit;
    color: #52514e;
    cursor: pointer;
  }

  select {
    width: 100%;
    margin-bottom: 8px;
  }

  dl {
    display: grid;
    grid-template-columns: auto auto;
    gap: 1px 8px;
    margin: 0;
  }

  dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  h2 {
    margin: 0 0 4px;
    font-size: 13px;
  }

  hr {
    height: 0;
    margin: 10px 0;
    border: 0;
    border-top: 1px solid #e3e0da;
  }

  /* The swatches thicken with the ramp, because the map encodes shade in
     width as well as colour and a legend has to show both. */
  .ramp {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 9px;
  }

  .ramp span {
    flex: 1;
    border-radius: 1px;
  }

  .ends {
    display: flex;
    justify-content: space-between;
    margin-bottom: 6px;
    color: #6b6a66;
  }

  .note {
    margin: 6px 0 0;
    color: #52514e;
  }

  details {
    margin-top: 10px;
    color: #6b6a66;
  }

  summary {
    cursor: pointer;
  }

  .error {
    margin: 0;
    color: #b91c1c;
  }

  /* A phone. The panel stops floating over the map and becomes a sheet on the
     bottom edge, where a thumb reaches, and everything past the controls and
     the route folds away so the map keeps most of the screen. */
  @media (max-width: 640px) {
    aside {
      top: auto;
      right: 0;
      bottom: 0;
      left: 0;
      width: auto;
      max-height: 68dvh;
      border-radius: 12px 12px 0 0;
      padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
      box-shadow: 0 -2px 12px rgb(0 0 0 / 0.18);
    }

    header button {
      min-height: 44px;
      min-width: 64px;
    }

    /* Fingers, not a mouse pointer. */
    aside :global(input[type="range"]) {
      height: 32px;
    }

    select,
    aside :global(input[type="date"]) {
      min-height: 40px;
    }
  }
</style>
