<script>
  import { onMount } from "svelte";
  import { base } from "$app/paths";
  import CityMap from "../components/Map.svelte";
  import ShadeSlider from "../components/ShadeSlider.svelte";
  import TimeSlider from "../components/TimeSlider.svelte";
  import { sunExposure, walked, weights } from "$lib/cost.js";
  import { loadCity, loadManifest, nodePoints, routeGeoJSON } from "$lib/load.js";
  import { astar, buildGraph, flatten, nearestNode, scratch } from "$lib/router.js";
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

  function send() {
    if (!worker || !seeded || !sun) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    seq += 1;
    worker.postMessage({ sun: { alt: sun.alt, azi: sun.azi }, seq });
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
      app.shade = { sigma: data.sigma, ms: data.ms, mean: total / data.sigma.length };
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
    const { height, polygonOffset, ringOffset, x, y } = city.buildings;
    worker.postMessage({
      scene: { buildings: { height, polygonOffset, ringOffset, x, y }, samples: city.samples },
    });
  });

  $effect(() => {
    sun;
    send();
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
    const view = flatten(buildGraph(city.graph));
    routing = {
      view,
      work: scratch(view),
      cost: new Float32Array(city.graph.u.length),
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

    const started = performance.now();
    weights(city.graph.length, shade.sigma, w, routing.cost);
    const found = astar(routing.view, routing.cost, city.graph.x, city.graph.y, from, to, routing.work);
    const elapsed = performance.now() - started;

    app.route = found && {
      edges: found.edges,
      nodes: found.nodes,
      metres: walked(found.edges, city.graph.length),
      sun: sunExposure(found.edges, city.graph.length, shade.sigma),
      ms: elapsed,
    };
  });

  const routeLine = $derived(app.route ? routeGeoJSON(city.graph, app.route.edges) : null);
  const endPoints = $derived(
    city ? nodePoints(city.graph, [app.from, app.to].filter((n) => n !== null)) : null,
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
</script>

<CityMap {city} route={routeLine} ends={endPoints} onpick={pick} />

<aside>
  <h1>DraCool</h1>

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

    <dl>
      <dt>altitude</dt>
      <dd>{sun.alt.toFixed(1)}°</dd>
      <dt>azimuth</dt>
      <dd>{sun.azi.toFixed(1)}°</dd>
      <dt>shade</dt>
      <dd>{app.shade ? `${(app.shade.mean * 100).toFixed(1)}%` : "…"}</dd>
      <dt>σ pass</dt>
      <dd>{app.shade ? ms(app.shade.ms) : "…"}</dd>
    </dl>

    <!-- RouteSummary.svelte in Phase 9 turns these into something readable,
         with the detour against the w = 0 route beside them. Sun exposure is
         here now because Section 6.1 calls it the number that means something
         whatever w is set to. -->
    <dl>
      {#if app.route}
        <dt>walk</dt>
        <dd>{(app.route.metres / 1000).toFixed(2)} km</dd>
        <dt>in sun</dt>
        <dd>{(app.route.sun / 1000).toFixed(2)} km</dd>
        <dt>route</dt>
        <dd>{ms(app.route.ms)}</dd>
      {:else}
        <dt>route</dt>
        <dd>
          {#if app.from === null}
            click a start
          {:else if app.to === null}
            click a finish
          {:else if !app.shade}
            waiting on shade
          {:else if app.from === app.to}
            same node
          {:else}
            no path
          {/if}
        </dd>
      {/if}
    </dl>

    <!-- Definition 1: below the horizon sigma is 1 everywhere by convention,
         so the number above is not a shade measurement and should not be read
         as one. Section 6.1's degenerate case, said out loud. -->
    {#if isNight(sun)}
      <p class="night">The sun is down. σ = 1 everywhere by convention.</p>
    {/if}

    <dl>
      <dt>nodes</dt>
      <dd>{city.meta.counts.nodes.toLocaleString()}</dd>
      <dt>edges</dt>
      <dd>{city.meta.counts.edges.toLocaleString()}</dd>
      <dt>buildings</dt>
      <dd>{city.meta.counts.buildings.toLocaleString()}</dd>
      <dt>fetch</dt>
      <dd>{ms(city.timings.fetch)}</dd>
      <dt>decode</dt>
      <dd>{ms(city.timings.decode)}</dd>
      <dt>polylines</dt>
      <dd>{ms(city.timings.draw)}</dd>
      <dt>samples</dt>
      <dd>{ms(city.timings.sample)}</dd>
      <dt>total</dt>
      <dd>{ms(city.timings.total)}</dd>
    </dl>

    <!-- Section 7 of the specification calls sparse heights the dominant error
         source in the system. This is a placeholder for DataQuality.svelte:
         the number is here from the first render rather than added later. -->
    <p class="quality">
      {(city.meta.height_provenance.default * 100).toFixed(0)}% of heights are a flat default.
    </p>
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
    width: 200px;
    padding: 12px 14px;
    border-radius: 6px;
    background: rgb(255 255 255 / 0.92);
    box-shadow: 0 1px 6px rgb(0 0 0 / 0.2);
  }

  h1 {
    margin: 0 0 8px;
    font-size: 15px;
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

  dl + dl {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #e3e0da;
  }

  .quality {
    margin: 8px 0 0;
    color: #6b5c3a;
  }

  .night {
    margin: 8px 0 0;
    color: #3f4a63;
  }

  .error {
    margin: 0;
    color: #b91c1c;
  }
</style>
