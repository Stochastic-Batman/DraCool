import { readFileSync } from "node:fs";
import { bidirectional } from "graphology-shortest-path/dijkstra";
import { describe, expect, it } from "vitest";
import { sunExposure, walked, weights } from "$lib/cost.js";
import { adjacency, astar, nearestNode, scratch } from "$lib/router.js";
import { graphOf, graphologyOf, streetsOf } from "./scene.js";


const scene = JSON.parse(readFileSync("../fixtures/reference/shade_mini.json", "utf8"));

// The scene's 242 edges are real streets, and their endpoints are the nodes
// they were cut from, so snapping coincident ones back together rebuilds an
// actual connected graph rather than a synthetic one. Sigma comes with it,
// already agreed with the pipeline by shade.test.js, at four sun positions.
const streets = streetsOf(scene);
const graph = graphologyOf(streets);
const view = adjacency(streets);
const work = scratch(view);

const WS = [0, 0.2, 1, 3];


describe("the fixture graph is worth routing on", () => {
  it("is one connected component", () => {
    expect(streets.x.length).toBe(101);
    expect(streets.u.length).toBe(scene.edges.length);

    const seen = new Uint8Array(streets.x.length);
    const stack = [0];
    seen[0] = 1;
    let count = 1;
    while (stack.length > 0) {
      const at = stack.pop();
      for (let i = view.offset[at]; i < view.offset[at + 1]; i += 1) {
        if (!seen[view.to[i]]) {
          seen[view.to[i]] = 1;
          count += 1;
          stack.push(view.to[i]);
        }
      }
    }
    expect(count).toBe(streets.x.length);
  });
});


describe("Proposition 3 (i): the cost is never below the length", () => {
  it("has a multiplier of 1 at full shade and 1 + w at none", () => {
    const length = Float32Array.from([100]);
    expect(weights(length, Float32Array.from([1]), 0.75)[0]).toBeCloseTo(100, 4);
    expect(weights(length, Float32Array.from([0]), 0.75)[0]).toBeCloseTo(175, 4);
  });

  it("recovers the plain shortest path at w = 0", () => {
    for (const sigma of [0, 0.5, 1]) {
      expect(weights(Float32Array.from([100]), Float32Array.from([sigma]), 0)[0]).toBe(100);
    }
  });

  it("never returns a weight below the edge's own length", () => {
    for (const w of WS) {
      for (const [j] of scene.suns.entries()) {
        const c = weights(streets.length, sigmaAt(j), w);
        for (let e = 0; e < c.length; e += 1) expect(c[e]).toBeGreaterThanOrEqual(streets.length[e]);
      }
    }
  });
});


function sigmaAt(j) {
  return Float32Array.from(scene.edges.map((e) => e.sigma[j]));
}

// A deterministic spread of pairs across the graph rather than adjacent ones,
// so the heuristic actually has room to be wrong.
function pairs() {
  const n = streets.x.length;
  const out = [];
  for (let i = 0; i < n; i += 7) out.push([i, (i * 37 + 13) % n]);
  return out.filter(([a, b]) => a !== b);
}


// Proposition 3 (ii) and (iii), tested the way they are used. graphology's own
// Dijkstra is the oracle: it has no heuristic to be wrong about, and it is a
// third-party implementation, so an error shared with our A* is unlikely.
describe("A* returns the same cost as Dijkstra", () => {
  for (const [j, sun] of scene.suns.entries()) {
    for (const w of WS) {
      it(`agrees at w = ${w} with the sun ${sun.label}`, () => {
        const cost = weights(streets.length, sigmaAt(j), w);
        const weight = (edge) => cost[+edge];
        let checked = 0;

        for (const [source, target] of pairs()) {
          const found = astar(view, cost, streets.x, streets.y, source, target, work);
          const optimal = bidirectional(graph, String(source), String(target), weight);

          expect(found).not.toBeNull();
          let best = 0;
          for (let i = 1; i < optimal.length; i += 1) {
            best += edgeCost(cost, optimal[i - 1], optimal[i]);
          }
          // Relative: an equal-cost path found in a different order sums the
          // same Float32 weights to a slightly different double.
          expect(Math.abs(found.cost - best)).toBeLessThan(1e-9 * Math.max(1, best));
          checked += 1;
        }

        expect(checked).toBeGreaterThan(10);
      });
    }
  }
});

// The oracle returns nodes, and a multigraph can hold several edges between
// two of them, so the cost of a step is the cheapest edge joining the pair.
function edgeCost(cost, a, b) {
  let best = Infinity;
  graph.forEachEdge(a, (key, attr, s, t) => {
    if (s === b || t === b) best = Math.min(best, cost[+key]);
  });
  return best;
}


describe("the route responds to the slider, not the worker", () => {
  const source = 0;
  const target = 50;

  it("takes a longer but shadier route as w rises", () => {
    const sigma = sigmaAt(2); // the high sun, which has real contrast
    const plain = astar(view, weights(streets.length, sigma, 0), streets.x, streets.y, source, target, work);
    const shady = astar(view, weights(streets.length, sigma, 4), streets.x, streets.y, source, target, work);

    const plainSun = sunExposure(plain.edges, streets.length, sigma);
    const shadySun = sunExposure(shady.edges, streets.length, sigma);

    // w = 0 is the shortest path by definition, so nothing can beat its length.
    expect(walked(shady.edges, streets.length)).toBeGreaterThanOrEqual(
      walked(plain.edges, streets.length) - 1e-6,
    );
    expect(shadySun).toBeLessThanOrEqual(plainSun + 1e-6);
  });

  it("reports sun exposure independently of w", () => {
    const sigma = sigmaAt(2);
    const route = astar(view, weights(streets.length, sigma, 1), streets.x, streets.y, source, target, work);
    const exposure = sunExposure(route.edges, streets.length, sigma);

    expect(exposure).toBeGreaterThanOrEqual(0);
    expect(exposure).toBeLessThanOrEqual(walked(route.edges, streets.length) + 1e-6);
  });

  it("has no sun exposure at night, when sigma is 1 everywhere", () => {
    const night = sigmaAt(3);
    const route = astar(view, weights(streets.length, night, 2), streets.x, streets.y, source, target, work);
    expect(sunExposure(route.edges, streets.length, night)).toBeCloseTo(0, 6);
  });
});


describe("a click snaps to the nearest node", () => {
  it("finds the node it is standing on", () => {
    for (const i of [0, 17, 60, 100]) {
      expect(nearestNode(streets.x, streets.y, streets.x[i], streets.y[i])).toBe(i);
    }
  });

  it("finds the nearest one from a point between them", () => {
    const near = nearestNode(streets.x, streets.y, streets.x[8] + 0.5, streets.y[8] + 0.5);
    expect(near).toBe(8);
  });
});


describe("the graph the client decodes routes the same way", () => {
  it("flattens graph.json's own layout into the same adjacency", () => {
    const g = graphOf({ edges: [{ polyline: [[0, 0], [10, 0]] }, { polyline: [[10, 0], [10, 5]] }] });
    const v = adjacency(g);
    expect(v.offset.length).toBe(g.x.length + 1);
    expect(v.to.length).toBe(2 * g.u.length);
  });
});
