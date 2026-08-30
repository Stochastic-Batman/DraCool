import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SAMPLE_SPACING_M } from "$lib/constants.js";
import { crosses, inside, rayEntry } from "$lib/geometry.js";
import { occluders, samplePoints, shade, shadowDisplacement, shadowLength } from "$lib/shade.js";
import { buildingsOf, graphOf } from "./scene.js";


const points = JSON.parse(readFileSync("../fixtures/reference/shadow_points.json", "utf8"));
const scene = JSON.parse(readFileSync("../fixtures/reference/shade_mini.json", "utf8"));

// sigma is kept in a Float32Array, and the golden records nine decimals, so
// six is the honest budget for a comparison between them. It is not slack for
// two implementations that only nearly agree: every edge below matches to the
// precision the storage can carry.
const F32 = 6;


describe("Proposition 1 and the Section 3.3 cap", () => {
  for (const h of [...new Set(points.cases.map((c) => c.height_m))]) {
    it(`displaces a ${h} m building as the pipeline does`, () => {
      for (const c of points.cases.filter((k) => k.height_m === h)) {
        const sun = { alt: c.altitude_deg, azi: c.azimuth_deg };
        expect(shadowLength(c.height_m, sun)).toBeCloseTo(c.length_m, 6);

        const [dx, dy] = shadowDisplacement(c.height_m, sun);
        expect(dx).toBeCloseTo(c.displacement[0], 6);
        expect(dy).toBeCloseTo(c.displacement[1], 6);
      }
    });
  }

  // Section 4's own cheap unit test: it catches a flipped sign and a swapped
  // azimuth convention at the same time.
  it("throws a due-south sun's shadow due north", () => {
    const [dx, dy] = shadowDisplacement(10, { alt: 45, azi: 180 });
    expect(dx).toBeCloseTo(0, 9);
    expect(dy).toBeCloseTo(10, 9);
  });

  it("caps the shadow below a_min and leaves it alone above", () => {
    expect(shadowLength(40, { alt: 1, azi: 0 })).toBe(200);
    expect(shadowLength(40, { alt: 45, azi: 0 })).toBeCloseTo(40, 9);
  });

  it("refuses to measure a shadow at night", () => {
    expect(() => shadowLength(10, { alt: -1, azi: 0 })).toThrow();
  });
});


describe("Section 5.2 sampling", () => {
  it("places ceil(l/Delta) points at the midpoints of equal intervals", () => {
    const g = graphOf({ edges: [{ polyline: [[0, 0], [12, 0]] }] });
    const s = samplePoints(g);

    expect(SAMPLE_SPACING_M).toBe(scene.sampling_spacing_m);
    expect(s.offset[1]).toBe(3);
    expect([...s.x]).toEqual([2, 6, 10]);
    expect([...s.y]).toEqual([0, 0, 0]);
  });

  it("gives even a sub-Delta edge one point", () => {
    const s = samplePoints(graphOf({ edges: [{ polyline: [[0, 0], [1, 0]] }] }));
    expect(s.offset[1]).toBe(1);
    expect(s.x[0]).toBeCloseTo(0.5, 9);
  });

  it("walks a bent polyline by arc length", () => {
    const s = samplePoints(graphOf({ edges: [{ polyline: [[0, 0], [0, 6], [8, 6]] }] }));
    expect(s.offset[1]).toBe(3);
    // 14 m in three intervals, midpoints at 7/3, 7 and 35/3, the last two
    // past the bend at 6 m.
    [0, 1, 17 / 3].forEach((v, i) => expect(s.x[i]).toBeCloseTo(v, 9));
    [7 / 3, 6, 6].forEach((v, i) => expect(s.y[i]).toBeCloseTo(v, 9));
  });
});


// shade() does not call rayEntry: it asks the cheaper question, because a
// point is inside at most one footprint and a boolean does not need the
// smallest tau. That is only allowed if the two agree everywhere, so they are
// held against each other on the fixture's own geometry.
describe("the fast predicate is tau_min <= L", () => {
  const b = buildingsOf(scene);

  it("agrees with rayEntry over the scene", () => {
    const sun = { alt: 20, azi: 135 };
    const [ux, uy] = [Math.sin(2.356), Math.cos(2.356)];
    let checked = 0;
    let shaded = 0;

    for (let k = 0; k < b.height.length; k += 1) {
      const r0 = b.polygonOffset[k];
      const r1 = b.polygonOffset[k + 1];
      const L = shadowLength(b.height[k], sun);
      const at = b.ringOffset[r0];

      // Points on and around each footprint: just outside it, well away from
      // it, and inside it, so both branches of the split are exercised.
      for (const [px, py] of [
        [b.x[at] - 3, b.y[at] - 3],
        [b.x[at] + 40, b.y[at] + 40],
        [b.x[at] - 120, b.y[at] - 120],
        [(b.x[at] + b.x[at + 2]) / 2, (b.y[at] + b.y[at + 2]) / 2],
      ]) {
        const slow = rayEntry(px, py, ux, uy, b.x, b.y, b.ringOffset, r0, r1) <= L;
        const fast =
          inside(px, py, b.x, b.y, b.ringOffset, r0, r1) ||
          crosses(px, py, ux, uy, L, b.x, b.y, b.ringOffset, r0, r1);
        expect(fast).toBe(slow);
        checked += 1;
        if (slow) shaded += 1;
      }
    }

    // A test where nothing is ever shaded would agree trivially.
    expect(checked).toBeGreaterThan(700);
    expect(shaded).toBeGreaterThan(0);
  });
});


// The claim the whole client architecture rests on. Two implementations of
// Proposition 2, in two languages, on the same scene, agreeing edge by edge.
describe("Proposition 2 reproduces the pipeline's sigma", () => {
  const occ = occluders(buildingsOf(scene));
  const samples = samplePoints(graphOf(scene));

  it("rebuilt the scene the golden describes", () => {
    expect(occ.height.length).toBe(scene.buildings.length);
    expect(samples.offset.length - 1).toBe(scene.edges.length);
    // Remark 3's geometry: courtyards are in here, so the hole handling in
    // geometry.js is on the path these tests actually take.
    const holed = [...occ.polygonOffset.slice(1)].filter(
      (end, k) => end - occ.polygonOffset[k] > 1,
    );
    expect(holed.length).toBeGreaterThan(0);
  });

  scene.suns.forEach((sun, j) => {
    it(`agrees on every edge with the sun ${sun.label}`, () => {
      const sigma = shade(samples, occ, { alt: sun.altitude_deg, azi: sun.azimuth_deg });
      scene.edges.forEach((e, i) => expect(sigma[i]).toBeCloseTo(e.sigma[j], F32));
    });
  });

  it("fixes sigma at 1 everywhere after sunset", () => {
    const sigma = shade(samples, occ, { alt: -5, azi: 270 });
    expect([...sigma].every((v) => v === 1)).toBe(true);
  });

  it("leaves a street with no buildings near it fully sunlit", () => {
    const far = samplePoints(graphOf({ edges: [{ polyline: [[9000, 9000], [9040, 9000]] }] }));
    expect([...shade(far, occ, { alt: 30, azi: 180 })]).toEqual([0]);
  });
});
