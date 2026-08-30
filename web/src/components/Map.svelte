<script>
  import { onDestroy, onMount } from "svelte";
  import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
  import "maplibre-gl/dist/maplibre-gl.css";
  import { BASEMAP } from "$lib/constants.js";
  import { SHADE_STEPS } from "$lib/overlay.js";

  // MapLibre is a quarter of a megabyte gzipped, and nothing can be drawn
  // until the city data has arrived anyway. Imported here rather than at the
  // top so it becomes its own chunk: the panel, the time control and the
  // error path do not wait on the renderer to paint.

  let { city, shade = null, route = null, ends = null, onpick = null } = $props();

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

  // A GeoJSON source needs data from the moment it is added, and an empty
  // collection is the one shape that suits both a line and a point layer.
  const EMPTY = { type: "FeatureCollection", features: [] };

  let container;
  let map = null;
  let ready = $state(false);
  // Raised once the sources exist, which is what the route effect below waits
  // on. `ready` only says the style loaded, and the city can arrive after it.
  let drawn = $state(false);

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
    const { AttributionControl, config, Map: MapLibre, NavigationControl } =
      await import("maplibre-gl");
    config.WORKER_URL = workerUrl;

    map = new MapLibre({
      container,
      style: await basemapStyle(),
      center: [0, 0],
      zoom: 1,
      // Placed by hand below. The default corner is the bottom, which is where
      // the panel sits on a phone, and the ODbL credit has to stay visible.
      attributionControl: false,
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new AttributionControl({ compact: true }), "top-right");
    map.on("error", (event) => console.warn("maplibre:", event.error?.message ?? event));
    map.on("click", (event) => onpick?.(event.lngLat.lng, event.lngLat.lat));
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

      // One layer per bucket, sitting over the plain network. They start empty
      // and stay so until the first shade pass lands; until then the neutral
      // `streets` layer is what shows, because colouring the city before sigma
      // exists would be asserting a measurement nobody has made.
      SHADE_STEPS.forEach((step, i) => {
        instance.addSource(`shade-${i}`, { type: "geojson", data: EMPTY, maxzoom: 14, buffer: 0 });
        instance.addLayer({
          id: `shade-${i}`,
          type: "line",
          source: `shade-${i}`,
          paint: { "line-color": step.color, "line-width": step.width },
        });
      });
    }

    // Empty to begin with; the route effect below fills them. They are added
    // here so they sit above the city layers whatever order things arrive in.
    for (const id of ["route", "ends"]) {
      if (!instance.getSource(id)) instance.addSource(id, { type: "geojson", data: EMPTY });
    }

    if (!instance.getLayer("route")) {
      // Orange, because blue is spoken for: the overlay uses the whole blue
      // ramp to mean a quantity, and a route drawn in it would read as another
      // value on that scale. The casing is the surface ring that keeps the
      // line legible where it crosses the darkest bands.
      instance.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.9 },
      });
      instance.addLayer({
        id: "route",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#eb6834", "line-width": 3.5 },
      });
      instance.addLayer({
        id: "ends",
        type: "circle",
        source: "ends",
        paint: {
          "circle-radius": 5,
          "circle-color": "#eb6834",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
    }

    const [west, south, east, north] = loaded.meta.bbox;
    instance.fitBounds([west, south, east, north], { padding: 24, animate: false });
    drawn = true;
  }

  $effect(() => {
    if (ready && city) draw(map, city);
  });

  // Separate from draw() so that a new route re-draws two small sources and
  // nothing else: the city layers stay as they are, and the view is not
  // re-fitted out from under someone who has panned.
  //
  // Both props are read before anything can return early. An effect only
  // subscribes to what it actually reads, so guarding first would leave it
  // subscribed to `drawn` alone on the pass where the sources do not exist
  // yet, and it would then never hear about a route again.
  $effect(() => {
    const line = route ?? EMPTY;
    const points = ends ?? EMPTY;
    if (!drawn) return;
    map.getSource("route").setData(line);
    map.getSource("ends").setData(points);
  });

  // The shade tier reaching the map. The plain network is hidden once there is
  // a real sigma to draw, and comes back if there is not.
  $effect(() => {
    const groups = shade;
    if (!drawn) return;
    SHADE_STEPS.forEach((step, i) => {
      map.getSource(`shade-${i}`).setData(groups ? groups[i] : EMPTY);
    });
    map.setLayoutProperty("streets", "visibility", groups ? "none" : "visible");
  });
</script>

<div class="map" bind:this={container}></div>

<style>
  .map {
    position: absolute;
    inset: 0;
  }
</style>
