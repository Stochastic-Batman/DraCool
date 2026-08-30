<script>
  import { onMount } from "svelte";
  import { base } from "$app/paths";
  import CityMap from "../components/Map.svelte";
  import { loadCity, loadManifest } from "$lib/load.js";

  let cities = $state([]);
  let key = $state(null);
  let city = $state(null);
  let error = $state(null);
  let busy = $state(false);

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

  .quality {
    margin: 8px 0 0;
    color: #6b5c3a;
  }

  .error {
    margin: 0;
    color: #b91c1c;
  }
</style>
