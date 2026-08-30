// The cheap tier of roadmap Section 1.2. Sigma enters the cost only through a
// per-edge multiplication and does not depend on w, so moving the shade slider
// is one pass over a contiguous array and never re-runs the worker.

// c(e) = l(e) (1 + w (1 - sigma(e))). l(e) is the length the pipeline measured
// in true UTM and shipped, not anything the client's own projection produced.
export function weights(length, sigma, w, out) {
  const n = length.length;
  const c = out ?? new Float32Array(n);
  for (let e = 0; e < n; e += 1) c[e] = length[e] * (1 + w * (1 - sigma[e]));
  return c;
}

// Metres of sunlit walking along a path. Section 6.1: this is meaningful
// whatever w is set to, which makes it the honest number to put in front of
// someone, where the cost itself is only meaningful against the same w.
export function sunExposure(edges, length, sigma) {
  let total = 0;
  for (const e of edges) total += length[e] * (1 - sigma[e]);
  return total;
}

export function walked(edges, length) {
  let total = 0;
  for (const e of edges) total += length[e];
  return total;
}
