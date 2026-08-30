<script>
  import { onDestroy, onMount } from "svelte";
  import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
  import "maplibre-gl/dist/maplibre-gl.css";
  import { BASEMAP } from "$lib/constants.js";

  // MapLibre is a quarter of a megabyte gzipped, and nothing can be drawn
  // until the city data has arrived anyway. Imported here rather than at the
  // top so it becomes its own chunk: the panel, the time control and the
  // error path do not wait on the renderer to paint.

  let { city } = $props();

  // MapLibre finds its worker with new URL("./maplibre-gl-worker.mjs",
  // import.meta.url), and builds that filename from a template literal. No
  // bundler can see it, so the file is never emitted and the URL resolves
  // beside a hashed chunk instead: a 404, no worker, and no renderer, which
  // looks exactly like a map that draws nothing. `?worker&url` builds it as a
  // worker entry point and hands back where Vite put it. Not plain `?url`:
  // that copies one file, and the worker imports maplibre-gl-shared.mjs.
  // Assigned once the module is in, and before any Map is constructed.

  // Drawn on a flat ground when there is no basemap, so the client owes no
  // tile provider anything and still renders with no network beyond its own
  // data. This style has no external resources at all, which is what makes it
  // a safe fallback: it cannot fail to load.
  const BLANK = {
    version: 8,
    sources: {},
    layers: [{ id: "ground", type: "background", paint: { "background-color": "#f4f2ee" } }],
  };

  let container;
  let map = null;
  let ready = $state(false);

  // Fetched here rather than handed to MapLibre as a URL. If the style cannot
  // be reached the map never fires `load`, and the city would never be drawn
  // either -- a blocked tile provider would take our own data down with it.
  async function basemapStyle() {
    if (!BASEMAP) return BLANK;
    try {
      const response = await fetch(BASEMAP);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (cause) {
      console.warn(`Basemap ${BASEMAP} did not load (${cause.message}); using a bare ground.`);
      return BLANK;
    }
  }

  onMount(async () => {
    const { config, Map: MapLibre, NavigationControl } = await import("maplibre-gl");
    config.WORKER_URL = workerUrl;

    map = new MapLibre({ container, style: await basemapStyle(), center: [0, 0], zoom: 1 });
    map.addControl(new NavigationControl(), "top-right");
    map.on("error", (event) => console.warn("maplibre:", event.error?.message ?? event));
    // `load` fires once. Latching it beats asking isStyleLoaded() later, which
    // answers false while a source is still resolving and leaves nothing to
    // wait for if the event has already gone.
    map.on("load", () => {
      ready = true;
    });
  });

  onDestroy(() => map?.remove());

  function draw(instance, loaded) {
    // The ODbL obligation of the data contract: the source carries it, so the
    // credit appears wherever the data does and cannot be left behind.
    const attribution = loaded.meta.attribution;

    for (const [id, data] of [
      ["buildings", loaded.buildings.geojson],
      ["streets", loaded.streets],
    ]) {
      const source = instance.getSource(id);
      if (source) {
        source.setData(data);
      } else {
        // maxzoom caps the tile pyramid and buffer 0 skips the neighbour
        // margin, both of which are work geojson-vt would otherwise do over
        // 832k vertices. Overzooming a z14 footprint tile costs nothing that
        // matters at building scale.
        instance.addSource(id, {
          type: "geojson",
          data,
          attribution,
          maxzoom: 14,
          buffer: 0,
        });
      }
    }

    if (!instance.getLayer("buildings")) {
      // Nothing requests a tile for a source no visible layer uses, so the
      // city-wide first view costs nothing for the footprints. They are also
      // sub-pixel at that zoom: 122k of them city-wide is a minute of tiling
      // to draw grey mush.
      instance.addLayer({
        id: "buildings",
        type: "fill",
        source: "buildings",
        minzoom: 13,
        paint: { "fill-color": "#3c3a38", "fill-opacity": 0.55 },
      });
      instance.addLayer({
        id: "streets",
        type: "line",
        source: "streets",
        paint: { "line-color": "#c2410c", "line-width": 1.2 },
      });
    }

    const [west, south, east, north] = loaded.meta.bbox;
    instance.fitBounds([west, south, east, north], { padding: 24, animate: false });
  }

  $effect(() => {
    if (ready && city) draw(map, city);
  });
</script>

<div class="map" bind:this={container}></div>

<style>
  .map {
    position: absolute;
    inset: 0;
  }
</style>
