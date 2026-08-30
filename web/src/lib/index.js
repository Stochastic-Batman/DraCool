import Flatbush from "flatbush";


// Static because footprints never change after load, which is the case a
// static R-tree is fastest at: it is packed once, bottom up, into flat typed
// arrays, and every later query is pointer-free.

// One box per footprint. The exterior ring bounds the holes, so a single pass
// over every vertex of the polygon costs nothing over walking the rings.
export function bboxes({ polygonOffset, ringOffset, x, y }) {
  const n = polygonOffset.length - 1;
  const x0 = new Float64Array(n);
  const y0 = new Float64Array(n);
  const x1 = new Float64Array(n);
  const y1 = new Float64Array(n);

  for (let k = 0; k < n; k += 1) {
    const first = ringOffset[polygonOffset[k]];
    const last = ringOffset[polygonOffset[k + 1]];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let i = first; i < last; i += 1) {
      if (x[i] < minX) minX = x[i];
      if (x[i] > maxX) maxX = x[i];
      if (y[i] < minY) minY = y[i];
      if (y[i] > maxY) maxY = y[i];
    }

    x0[k] = minX;
    y0[k] = minY;
    x1[k] = maxX;
    y1[k] = maxY;
  }

  return { x0, y0, x1, y1 };
}

// An index over a subset of the footprints. `items` maps a position in the
// tree back to the building it came from.
export function buildIndex(box, items) {
  if (items.length === 0) return null;

  const tree = new Flatbush(items.length);
  for (const k of items) tree.add(box.x0[k], box.y0[k], box.x1[k], box.y1[k]);
  tree.finish();
  return tree;
}
