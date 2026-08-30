<script>
  import { onMount } from "svelte";
  import { base } from "$app/paths";
  import CityMap from "../components/Map.svelte";
  import TimeSlider from "../components/TimeSlider.svelte";
  import { loadCity, loadManifest } from "$lib/load.js";
  import { isNight, sunPosition } from "$lib/solar.js";

  let cities = $state([]);
  let key = $state(null);
  let city = $state(null);
  let error = $state(null);
  let busy = $state(false);

  // Snapped to the slider's own step, so the control and the clock beside it
  // agree from the first paint. Every IANA offset is a whole quarter hour, so
  // a multiple of five minutes survives the trip into any city's zone.
  const STEP_MS = 5 * 60 * 1000;
  let when = $state(new Date(Math.round(Date.now() / STEP_MS) * STEP_MS));
  let shade = $state(null);

  const tz = $derived(city?.meta.timezone ?? "UTC");
  const sun = $derived(
    city ? sunPosition(when, city.meta.center[1], city.meta.center[0]) : null,
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
      shade = { sigma: data.sigma, ms: data.ms, mean: total / data.sigma.length };
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
    shade = null;
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

<CityMap {city} />

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
    <TimeSlider {tz} bind:when />

    <dl>
      <dt>altitude</dt>
      <dd>{sun.alt.toFixed(1)}°</dd>
      <dt>azimuth</dt>
      <dd>{sun.azi.toFixed(1)}°</dd>
      <dt>shade</dt>
      <dd>{shade ? `${(shade.mean * 100).toFixed(1)}%` : "…"}</dd>
      <dt>σ pass</dt>
      <dd>{shade ? ms(shade.ms) : "…"}</dd>
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
