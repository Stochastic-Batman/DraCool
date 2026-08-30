import { localFrame } from "./project.js";
import { samplePoints } from "./shade.js";


// The geometry tier of roadmap Section 1.2: everything here depends on the
// city data alone, not on the sun and not on w, so it is built once at load
// and reused by every later recomputation.

async function json(fetchFn, url) {
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

export async function loadManifest(fetchFn, base = "") {
  const manifest = await json(fetchFn, `${base}/data/cities.json`);
  return manifest.cities;
}

function decodeGraph(raw, frame) {
  const lon = Float64Array.from(raw.nodes.lon);
  const lat = Float64Array.from(raw.nodes.lat);
  const nodes = frame.forwardInto(lon, lat);

  // coords holds the interior points only; an edge runs node u, its slice,
  // node v. See the data contract in the roadmap.
  const points = raw.edges.coords.length / 2;
  const interiorLon = new Float64Array(points);
  const interiorLat = new Float64Array(points);
  for (let i = 0; i < points; i += 1) {
    interiorLon[i] = raw.edges.coords[2 * i];
    interiorLat[i] = raw.edges.coords[2 * i + 1];
  }
  const interior = frame.forwardInto(interiorLon, interiorLat);

  return {
    lon,
    lat,
    x: nodes.x,
    y: nodes.y,
    u: Int32Array.from(raw.edges.u),
    v: Int32Array.from(raw.edges.v),
    length: Float32Array.from(raw.edges.len),
    interiorOffset: Int32Array.from(raw.edges.geom_offset.map((value) => value / 2)),
    interiorLon,
    interiorLat,
    interiorX: interior.x,
    interiorY: interior.y,
  };
}

// One MultiLineString rather than a feature per edge: the map draws all of
// them the same way at this stage, and 119k features would be paid for twice,
// once in the allocation and once in the tiling.
export function streetGeoJSON(graph) {
  const lines = [];
  for (let e = 0; e < graph.u.length; e += 1) {
    const line = [[graph.lon[graph.u[e]], graph.lat[graph.u[e]]]];
    for (let i = graph.interiorOffset[e]; i < graph.interiorOffset[e + 1]; i += 1) {
      line.push([graph.interiorLon[i], graph.interiorLat[i]]);
    }
    line.push([graph.lon[graph.v[e]], graph.lat[graph.v[e]]]);
    lines.push(line);
  }
  return { type: "MultiLineString", coordinates: lines };
}

// Footprints flattened into CSR: polygon -> its rings -> their vertices, in
// metres. Holes are kept, because a courtyard wall casts shadow into the
// courtyard and Proposition 2 is a statement about the polygon, not its hull.
function decodeBuildings(geojson, frame) {
  const features = geojson.features;
  const count = features.length;

  let rings = 0;
  let vertices = 0;
  for (const feature of features) {
    rings += feature.geometry.coordinates.length;
    for (const ring of feature.geometry.coordinates) {
      vertices += ring.length;
    }
  }

  const height = new Float32Array(count);
  const source = new Uint8Array(count);
  const polygonOffset = new Int32Array(count + 1);
  const ringOffset = new Int32Array(rings + 1);
  const x = new Float64Array(vertices);
  const y = new Float64Array(vertices);

  let ring = 0;
  let vertex = 0;
  for (let i = 0; i < count; i += 1) {
    const feature = features[i];
    height[i] = feature.properties.h;
    source[i] = feature.properties.hs;
    polygonOffset[i] = ring;

    for (const coordinates of feature.geometry.coordinates) {
      ringOffset[ring] = vertex;
      ring += 1;
      for (const [lon, lat] of coordinates) {
        const [px, py] = frame.forward(lon, lat);
        x[vertex] = px;
        y[vertex] = py;
        vertex += 1;
      }
    }
  }
  polygonOffset[count] = ring;
  ringOffset[rings] = vertex;

  return { geojson, height, source, polygonOffset, ringOffset, x, y };
}

export async function loadCity(fetchFn, key, base = "") {
  const directory = `${base}/data/${key}`;
  const started = performance.now();

  const meta = await json(fetchFn, `${directory}/meta.json`);
  const [rawGraph, rawBuildings] = await Promise.all([
    json(fetchFn, `${directory}/graph.json`),
    json(fetchFn, `${directory}/buildings.geojson`),
  ]);
  const fetched = performance.now();

  const frame = localFrame(meta.center);
  const graph = decodeGraph(rawGraph, frame);
  const buildings = decodeBuildings(rawBuildings, frame);
  const decoded = performance.now();

  const streets = streetGeoJSON(graph);
  const drawn = performance.now();

  // Sample points close out the geometry tier: they depend on the edge
  // geometry and Delta, not on the sun and not on w, so every later shade pass
  // reuses them.
  const samples = samplePoints(graph);
  const finished = performance.now();

  return {
    meta,
    frame,
    graph,
    buildings,
    streets,
    samples,
    timings: {
      fetch: fetched - started,
      decode: decoded - fetched,
      draw: drawn - decoded,
      sample: finished - drawn,
      total: finished - started,
    },
  };
}
