import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { direction, horizontal, isNight, sunPosition, zonedToUtc } from "$lib/solar.js";


// Python generates, JavaScript asserts. A diff in the golden is a change in
// behaviour and has to be reviewed as one; nothing here may be relaxed to make
// a failure go away.
const golden = JSON.parse(readFileSync("../fixtures/reference/solar.json", "utf8"));

// The file rounds to nine decimals, so that is the whole budget. This is not a
// tolerance for two algorithms that nearly agree: suncalc-py is a port of the
// suncalc this imports, and they are expected to agree to the last digit.
const EXACT = 1e-8;


describe("the solar oracle reproduces the pipeline", () => {
  it("covers every case in the golden", () => {
    expect(golden.cases.length).toBe(160);
  });

  for (const c of golden.cases) {
    it(`${c.site} at ${c.utc}`, () => {
      const sun = sunPosition(new Date(c.utc), c.lat, c.lon);

      expect(sun.alt).toBeCloseTo(c.altitude_deg, 8);

      // Compared on the circle: 359.9999 and 0.0001 are the same azimuth, and
      // a raw difference would call them a third of a degree apart.
      const d = Math.abs(sun.azi - c.azimuth_deg);
      expect(Math.min(d, 360 - d)).toBeLessThan(EXACT);

      for (const [i, v] of direction(sun).entries()) expect(v).toBeCloseTo(c.direction[i], 8);
      for (const [i, v] of horizontal(sun).entries()) {
        expect(v).toBeCloseTo(c.horizontal_direction[i], 8);
      }
    });
  }
});


// Remark 2's trap, stated as the document states it. These would still pass if
// the golden were regenerated wrongly, which is the point of having both.
describe("the azimuth convention is north-based", () => {
  it("points east on the eastern horizon", () => {
    const [x, y, z] = direction({ alt: 0, azi: 90 });
    expect(x).toBeCloseTo(1, 12);
    expect(y).toBeCloseTo(0, 12);
    expect(z).toBeCloseTo(0, 12);
  });

  it("has a due-south sun pointing south, not north", () => {
    const [x, y] = horizontal({ alt: 30, azi: 180 });
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(-1, 12);
  });

  // Solar noon in Tbilisi is about 13:04 local, so the sun sits just short of
  // due south here. A south-based reading would answer roughly 0 instead.
  // Altitude at the June solstice reaches 90 - 41.69 + 23.44 = 71.75 degrees.
  it("puts the sun due south of a northern city at solar noon", () => {
    const sun = sunPosition(zonedToUtc("Asia/Tbilisi", 2026, 6, 21, 13, 0), 41.6941, 44.8336);
    expect(sun.azi).toBeCloseTo(178, 0);
    expect(sun.alt).toBeCloseTo(71.75, 0);
  });
});


describe("night is the Definition 1 convention", () => {
  it("is night at or below the horizon", () => {
    expect(isNight({ alt: 0, azi: 0 })).toBe(true);
    expect(isNight({ alt: -0.001, azi: 0 })).toBe(true);
    expect(isNight({ alt: 0.001, azi: 0 })).toBe(false);
  });

  it("is night in Tbilisi at local midnight", () => {
    const sun = sunPosition(zonedToUtc("Asia/Tbilisi", 2026, 6, 21, 0, 0), 41.6941, 44.8336);
    expect(isNight(sun)).toBe(true);
  });
});


// The slider reads wall-clock time and the oracle takes UTC, so this is the
// join between them. Georgia has no DST; Germany does, which is the case a
// fixed offset would get wrong for half the year.
describe("wall-clock time resolves through the city zone", () => {
  it("applies a fixed offset where there is no DST", () => {
    expect(zonedToUtc("Asia/Tbilisi", 2026, 6, 21, 13, 0).toISOString()).toBe(
      "2026-06-21T09:00:00.000Z",
    );
    expect(zonedToUtc("Asia/Tbilisi", 2026, 12, 21, 13, 0).toISOString()).toBe(
      "2026-12-21T09:00:00.000Z",
    );
  });

  it("follows the offset across a DST boundary", () => {
    expect(zonedToUtc("Europe/Berlin", 2026, 1, 15, 12, 0).toISOString()).toBe(
      "2026-01-15T11:00:00.000Z",
    );
    expect(zonedToUtc("Europe/Berlin", 2026, 7, 15, 12, 0).toISOString()).toBe(
      "2026-07-15T10:00:00.000Z",
    );
  });
});
