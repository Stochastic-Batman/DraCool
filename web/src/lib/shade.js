import { MAX_SHADOW_LENGTH_M, MIN_ALTITUDE_DEG, SAMPLE_SPACING_M } from "./constants.js";
import { crosses, inside } from "./geometry.js";
import { bboxes, buildIndex } from "./index.js";
import { horizontal, isNight } from "./solar.js";


const DEG = Math.PI / 180;

// Measured on Tbilisi: eleven octave bands cost 495 ms a pass, four cost 376,
// and two cost 554 because the crowded low band then gets searched at a tall
// building's reach. Four is the floor of that curve.
const MAX_BANDS = 4;


// L = h / tan(a), with the Section 3.3 cap. Night is the caller's business:
// Definition 1 fixes sigma = 1 for every edge and no shadow is computed at all.
export function shadowLength(h, sun) {
  if (isNight(sun)) throw new Error(`The sun is at ${sun.alt} degrees; sigma is 1 by convention.`);
  const L = h / Math.tan(sun.alt * DEG);
  return sun.alt < MIN_ALTITUDE_DEG ? Math.min(L, MAX_SHADOW_LENGTH_M) : L;
}

// Proposition 1: d = -L * u-hat, pointing away from the sun. The client never
// builds a shadow polygon -- that is what Proposition 2 buys us -- but the
// displacement is what shadow_points.json pins, so it lives here.
export function shadowDisplacement(h, sun) {
  const L = shadowLength(h, sun);
  const [e, n] = horizontal(sun);
  return [-L * e, -L * n];
}

function polyline(g, e, x, y) {
  const first = g.interiorOffset[e];
  const k = g.interiorOffset[e + 1] - first;

  x[0] = g.x[g.u[e]];
  y[0] = g.y[g.u[e]];
  for (let i = 0; i < k; i += 1) {
    x[i + 1] = g.interiorX[first + i];
    y[i + 1] = g.interiorY[first + i];
  }
  x[k + 1] = g.x[g.v[e]];
  y[k + 1] = g.y[g.v[e]];

  return k + 2;
}

// Section 5.2: m = ceil(l(e)/Delta) points at the midpoints of equal sub-
// intervals. They depend on the edge geometry and Delta alone, not on the sun
// and not on w, so this runs once at load and every later shade pass reuses it.
export function samplePoints(g) {
  const n = g.u.length;
  const offset = new Int32Array(n + 1);
  const length = new Float64Array(n);

  let widest = 0;
  for (let e = 0; e < n; e += 1) {
    widest = Math.max(widest, g.interiorOffset[e + 1] - g.interiorOffset[e] + 2);
  }
  const px = new Float64Array(widest);
  const py = new Float64Array(widest);

  for (let e = 0; e < n; e += 1) {
    const k = polyline(g, e, px, py);
    let L = 0;
    for (let i = 1; i < k; i += 1) L += Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1]);
    length[e] = L;
    offset[e + 1] = offset[e] + Math.max(1, Math.ceil(L / SAMPLE_SPACING_M));
  }

  const x = new Float64Array(offset[n]);
  const y = new Float64Array(offset[n]);

  for (let e = 0; e < n; e += 1) {
    const k = polyline(g, e, px, py);
    const m = offset[e + 1] - offset[e];
    const step = length[e] / m;

    // The offsets increase, so one forward walk over the segments serves all
    // m of them. s is the segment from vertex s to s+1, before is the arc
    // length up to its start.
    let s = 0;
    let before = 0;
    let span = Math.hypot(px[1] - px[0], py[1] - py[0]);

    for (let i = 0; i < m; i += 1) {
      const d = (i + 0.5) * step;
      while (s < k - 2 && before + span < d) {
        before += span;
        s += 1;
        span = Math.hypot(px[s + 1] - px[s], py[s + 1] - py[s]);
      }
      const f = span > 0 ? (d - before) / span : 0;
      x[offset[e] + i] = px[s] + f * (px[s + 1] - px[s]);
      y[offset[e] + i] = py[s] + f * (py[s + 1] - py[s]);
    }
  }

  return { offset, x, y };
}

// One index per octave of building height. Every L_k scales with h_k, so a
// single index has to be queried at the reach of the tallest building in the
// city: in Tbilisi one 275 m tower makes that 1953 m at an 8 degree sun, while
// the median building reaches 57 m. Searching the whole city at the tower's
// reach for every sample point costs a thousandfold in area. Banded, the
// crowded low band is queried at its own short reach and the tall band holds
// almost nothing. The bands partition the buildings, so the union of the
// queries is what the single query would have found: this is exact, not a
// heuristic, and only the search order changes.
export function occluders({ height, polygonOffset, ringOffset, x, y }) {
  const box = bboxes({ polygonOffset, ringOffset, x, y });
  const members = new Map();

  for (let k = 0; k < height.length; k += 1) {
    const octave = height[k] > 0 ? Math.ceil(Math.log2(height[k])) : 0;
    if (!members.has(octave)) members.set(octave, []);
    members.get(octave).push(k);
  }

  // Ascending, so the cheap crowded queries run first and a hit there spares
  // the expensive ones entirely.
  let groups = [...members.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, items]) => {
      let top = 0;
      for (const k of items) top = Math.max(top, height[k]);
      return { items, top };
    });

  // Every band costs one index descent per edge, and Tbilisi's heights span
  // eleven octaves while carrying almost nothing in the tall ones, so the
  // descents came to more than the candidates did. Bands are merged back until
  // there are few enough, cheapest merge first: a band's search cost goes as
  // its population times the square of its reach, so absorbing a sparse band
  // into a taller neighbour is nearly free, while merging the crowded low band
  // upward is not and does not happen.
  while (groups.length > MAX_BANDS) {
    let at = 0;
    let cheapest = Infinity;
    for (let i = 0; i + 1 < groups.length; i += 1) {
      const cost = groups[i].items.length * (groups[i + 1].top ** 2 - groups[i].top ** 2);
      if (cost < cheapest) {
        cheapest = cost;
        at = i;
      }
    }
    groups[at + 1].items = groups[at].items.concat(groups[at + 1].items);
    groups.splice(at, 1);
  }

  const bands = groups.map(({ items, top }) => ({
    items: Int32Array.from(items),
    tree: buildIndex(box, items),
    top,
  }));

  return { height, polygonOffset, ringOffset, x, y, box, bands };
}

// Proposition 2, per sample point: look towards the sun and walk, and you are
// shaded if you meet a building before going further than that building's own
// shadow length. Because "some tau in [0, L_k]" is the same statement as
// "tau_min <= L_k", this is the proposition itself and not an approximation
// of it. No union is ever built, which is what makes it cheap enough here.
// `stride` takes every k-th sample point of each edge instead of all of them,
// which is Section 5.2's estimator at a coarser Delta without a second set of
// points to keep. It is a preview: at stride 1 this is the sigma the pipeline
// agrees with, and the caller is expected to come back for that once the
// slider has stopped moving.
export function shade(samples, occ, sun, out, stride = 1) {
  const n = samples.offset.length - 1;
  const sigma = out ?? new Float32Array(n);

  if (isNight(sun)) {
    sigma.fill(1);
    return sigma;
  }

  const { bands, box, height, polygonOffset, ringOffset, x, y } = occ;
  const [ux, uy] = horizontal(sun);

  const L = new Float64Array(height.length);
  let reach = 0;
  for (let k = 0; k < height.length; k += 1) {
    L[k] = shadowLength(height[k], sun);
    if (L[k] > reach) reach = L[k];
  }

  if (reach === 0) {
    sigma.fill(0);
    return sigma;
  }

  const reaches = bands.map((b) => shadowLength(b.top, sun));

  // The samples of one edge lie within metres of each other and look the same
  // way, so their queries return almost the same candidates. Gathering once
  // per edge instead of once per sample turns a tree descent per sample into a
  // scan of a short array, and an edge carries a dozen samples on this data.
  // Returning false keeps flatbush from allocating a result array of its own.
  const cand = new Int32Array(height.length);
  let items = null;
  let count = 0;
  const collect = (i) => {
    cand[count] = items[i];
    count += 1;
    return false;
  };

  for (let e = 0; e < n; e += 1) {
    const start = samples.offset[e];
    const end = samples.offset[e + 1];

    // Bounded by the points actually tested, so a coarse pass also queries a
    // smaller box rather than paying for samples it will skip.
    let sx0 = Infinity;
    let sy0 = Infinity;
    let sx1 = -Infinity;
    let sy1 = -Infinity;
    for (let i = start; i < end; i += stride) {
      if (samples.x[i] < sx0) sx0 = samples.x[i];
      if (samples.x[i] > sx1) sx1 = samples.x[i];
      if (samples.y[i] < sy0) sy0 = samples.y[i];
      if (samples.y[i] > sy1) sy1 = samples.y[i];
    }

    // Bands stay in ascending order in cand, so the crowded short buildings
    // are tested first and a hit there skips the rest.
    count = 0;
    for (let b = 0; b < bands.length; b += 1) {
      if (bands[b].tree === null) continue;
      const rx = reaches[b] * ux;
      const ry = reaches[b] * uy;
      items = bands[b].items;
      bands[b].tree.search(
        Math.min(sx0, sx0 + rx),
        Math.min(sy0, sy0 + ry),
        Math.max(sx1, sx1 + rx),
        Math.max(sy1, sy1 + ry),
        collect,
      );
    }

    let shaded = 0;
    let taken = 0;
    for (let i = start; i < end; i += stride) {
      taken += 1;
      const px = samples.x[i];
      const py = samples.y[i];

      for (let c = 0; c < count; c += 1) {
        const k = cand[c];

        // The gather was widened to a whole edge and to the band's tallest
        // member. This building's own ray cannot leave the box below, so a
        // miss here is a miss, and it costs four comparisons instead of a
        // walk around the footprint.
        const ex = px + L[k] * ux;
        const ey = py + L[k] * uy;
        if (Math.min(px, ex) > box.x1[k] || Math.max(px, ex) < box.x0[k]) continue;
        if (Math.min(py, ey) > box.y1[k] || Math.max(py, ey) < box.y0[k]) continue;

        const r0 = polygonOffset[k];
        const r1 = polygonOffset[k + 1];

        // tau_min <= L_k, split so neither half is paid for needlessly: the
        // point is inside at most one footprint in the city, so that test is
        // guarded by the box, and outside one the crossing decides it without
        // having to find the smallest tau.
        const within =
          px >= box.x0[k] && px <= box.x1[k] && py >= box.y0[k] && py <= box.y1[k];

        if (
          (within && inside(px, py, x, y, ringOffset, r0, r1)) ||
          crosses(px, py, ux, uy, L[k], x, y, ringOffset, r0, r1)
        ) {
          shaded += 1;
          break;
        }
      }
    }

    sigma[e] = shaded / taken;
  }

  return sigma;
}
