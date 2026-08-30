// Footprints arrive as CSR (see load.js): a polygon owns rings r0..r1, a ring
// owns the vertices between its offsets. Both routines below take that slice
// directly and allocate nothing, because they run once per sample point per
// candidate building and there are on the order of a million of those.


// Even-odd over every ring of the polygon at once. A point in a courtyard
// crosses the outer ring and then the inner one, so the parity puts it
// outside, which is what Shapely says about a polygon with a hole too.
export function inside(px, py, x, y, ringOffset, r0, r1) {
  let odd = false;

  for (let r = r0; r < r1; r += 1) {
    const start = ringOffset[r];
    const end = ringOffset[r + 1];

    for (let i = start; i < end; i += 1) {
      const j = i + 1 === end ? start : i + 1;
      const yi = y[i];
      const yj = y[j];
      if (yi > py === yj > py) continue;
      if (px < x[i] + ((py - yi) / (yj - yi)) * (x[j] - x[i])) odd = !odd;
    }
  }

  return odd;
}

// Does the ray meet the boundary within L? Proposition 2 asks whether some
// tau in [0, L] lands in the footprint, which for a point outside it is this
// question, and answering it does not need the smallest such tau. The caller
// pairs it with inside() for the case where p is already in the footprint.
// shade.test.js holds it to rayEntry, which is the readable statement.
export function crosses(px, py, ux, uy, L, x, y, ringOffset, r0, r1) {
  for (let r = r0; r < r1; r += 1) {
    const start = ringOffset[r];
    const end = ringOffset[r + 1];

    for (let i = start; i < end; i += 1) {
      const j = i + 1 === end ? start : i + 1;
      const ex = x[j] - x[i];
      const ey = y[j] - y[i];

      const den = ux * ey - uy * ex;
      if (den === 0) continue;

      const qx = x[i] - px;
      const qy = y[i] - py;
      const s = (qx * uy - qy * ux) / den;
      if (s < 0 || s > 1) continue;

      const t = (qx * ey - qy * ex) / den;
      if (t >= 0 && t <= L) return true;
    }
  }

  return false;
}

// The smallest t >= 0 with p + t*u inside the polygon, or Infinity. Zero when
// p is already inside. Outside, the first boundary the ray meets is an entry:
// a hole's ring lies within the exterior, so it cannot be reached first.
export function rayEntry(px, py, ux, uy, x, y, ringOffset, r0, r1) {
  if (inside(px, py, x, y, ringOffset, r0, r1)) return 0;

  let best = Infinity;

  for (let r = r0; r < r1; r += 1) {
    const start = ringOffset[r];
    const end = ringOffset[r + 1];

    for (let i = start; i < end; i += 1) {
      const j = i + 1 === end ? start : i + 1;
      const ex = x[j] - x[i];
      const ey = y[j] - y[i];

      // Parallel. A ray running along an edge still enters through whichever
      // edge meets it at an angle, so there is nothing to lose by skipping.
      const den = ux * ey - uy * ex;
      if (den === 0) continue;

      const qx = x[i] - px;
      const qy = y[i] - py;
      const s = (qx * uy - qy * ux) / den;
      if (s < 0 || s > 1) continue;

      const t = (qx * ey - qy * ex) / den;
      if (t >= 0 && t < best) best = t;
    }
  }

  return best;
}
