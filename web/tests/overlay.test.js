import { describe, expect, it } from "vitest";
import { SHADE_STEPS, shadeBuckets } from "$lib/overlay.js";


const lines = [
  [[0, 0], [1, 0]],
  [[1, 0], [2, 0]],
  [[2, 0], [3, 0]],
  [[3, 0], [4, 0]],
  [[4, 0], [5, 0]],
];


describe("the shade overlay is a sequential encoding", () => {
  it("is one hue, light to dark", () => {
    expect(SHADE_STEPS).toHaveLength(5);
    const light = SHADE_STEPS.map(({ color }) => {
      const n = parseInt(color.slice(1), 16);
      return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255);
    });
    // Monotone: more shade is darker, with no step repeating another's weight.
    for (let i = 1; i < light.length; i += 1) expect(light[i]).toBeLessThan(light[i - 1]);
  });

  // Colour is not the only channel, so the overlay still reads for a
  // colour-blind viewer and at a zoom where a line is one pixel wide.
  it("thickens with the same quantity it darkens with", () => {
    const widths = SHADE_STEPS.map(({ width }) => width);
    for (let i = 1; i < widths.length; i += 1) expect(widths[i]).toBeGreaterThan(widths[i - 1]);
  });

  it("keeps every edge, and each in exactly one bucket", () => {
    const groups = shadeBuckets(lines, Float32Array.from([0, 0.3, 0.55, 0.9, 1]));
    expect(groups).toHaveLength(SHADE_STEPS.length);
    expect(groups.reduce((n, g) => n + g.coordinates.length, 0)).toBe(lines.length);
  });

  it("puts each sigma in the band that contains it", () => {
    const groups = shadeBuckets(lines, Float32Array.from([0, 0.3, 0.55, 0.9, 1]));
    expect(groups[0].coordinates).toEqual([lines[0]]);
    expect(groups[1].coordinates).toEqual([lines[1]]);
    expect(groups[2].coordinates).toEqual([lines[2]]);
    expect(groups[4].coordinates).toEqual([lines[3], lines[4]]);
    expect(groups[3].coordinates).toEqual([]);
  });

  it("puts a boundary value in the higher band", () => {
    const groups = shadeBuckets([lines[0]], Float32Array.from([0.2]));
    expect(groups[1].coordinates).toEqual([lines[0]]);
    expect(groups[0].coordinates).toEqual([]);
  });

  // Night is sigma = 1 everywhere, so the whole city lands in the darkest band
  // and the map says "all shade" -- which is the honest picture of a convention.
  it("collapses to the darkest band at night", () => {
    const groups = shadeBuckets(lines, Float32Array.from([1, 1, 1, 1, 1]));
    expect(groups[4].coordinates).toHaveLength(lines.length);
  });

  // Shared references, not copies: re-sorting the city on every sun move is
  // only cheap because the geometry is never rebuilt.
  it("shares the coordinate arrays rather than copying them", () => {
    const groups = shadeBuckets(lines, Float32Array.from([0, 0, 0, 0, 0]));
    expect(groups[0].coordinates[0]).toBe(lines[0]);
  });
});
