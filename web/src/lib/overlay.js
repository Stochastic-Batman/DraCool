// Sigma is a magnitude on [0, 1], so colouring the network by it is a
// sequential encoding: one hue, light to dark, more shade darker. Never a
// rainbow, and no hue at the middle -- 0.5 is half a street's length in shadow,
// not a pivot between two opposite things.
//
// Discrete buckets rather than a per-edge paint expression, because MapLibre
// styles a layer at a time: five sources holding shared coordinate arrays
// re-tile far more cheaply than 119k separately-addressed features would.
//
// The full 100->700 span of the blue ramp, which is the sequential range: the
// lightest step means near zero and is meant to recede toward the surface. An
// ordinal ramp would hold its light end above a 2:1 contrast floor, and that is
// wrong here -- it paints a sunlit street a confident blue and leaves the whole
// city looking half shaded. Monotone lightness, adjacent gaps and single hue
// are checked; only the ordinal floor is deliberately not met.
//
// Width carries the same quantity a second time. Shade then survives a
// colour-blind reader, a greyscale print and a zoomed-out city where the lines
// are a pixel wide and the hue has nowhere to show.
export const SHADE_STEPS = [
  { below: 0.2, color: "#cde2fb", width: 1 },
  { below: 0.4, color: "#86b6ef", width: 1.2 },
  { below: 0.6, color: "#3987e5", width: 1.5 },
  { below: 0.8, color: "#1c5cab", width: 1.9 },
  { below: Infinity, color: "#0d366b", width: 2.4 },
];

// The coordinate arrays are the ones built once at load: an edge is pushed by
// reference into whichever bucket it falls in, so a new sun re-sorts pointers
// and copies no geometry.
export function shadeBuckets(lines, sigma) {
  const groups = SHADE_STEPS.map(() => []);

  for (let e = 0; e < lines.length; e += 1) {
    let b = 0;
    while (sigma[e] >= SHADE_STEPS[b].below) b += 1;
    groups[b].push(lines[e]);
  }

  return groups.map((coordinates) => ({ type: "MultiLineString", coordinates }));
}
