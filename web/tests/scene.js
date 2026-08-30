// shade_mini.json carries each footprint as one flat coordinate run, the way
// shapely.get_coordinates emits it, so the ring structure has to be recovered
// before the client's CSR layout can be rebuilt. A ring is closed, so it ends
// at the first repeat of its own first vertex.
function rings(points) {
  const bounds = [];
  let i = 0;

  while (i < points.length) {
    let j = i + 1;
    while (j < points.length && !(points[j][0] === points[i][0] && points[j][1] === points[i][1])) {
      j += 1;
    }
    bounds.push([i, j + 1]);
    i = j + 1;
  }

  return bounds;
}

// The same shape decodeBuildings() produces at runtime, so the tests exercise
// the production layout rather than a convenience of their own.
export function buildingsOf(golden) {
  const parts = golden.buildings.map((b) => rings(b.polygon));
  const ringCount = parts.reduce((n, r) => n + r.length, 0);
  const vertices = golden.buildings.reduce((n, b) => n + b.polygon.length, 0);

  const height = new Float32Array(golden.buildings.length);
  const polygonOffset = new Int32Array(golden.buildings.length + 1);
  const ringOffset = new Int32Array(ringCount + 1);
  const x = new Float64Array(vertices);
  const y = new Float64Array(vertices);

  let r = 0;
  let v = 0;
  golden.buildings.forEach((b, k) => {
    height[k] = b.height_m;
    polygonOffset[k] = r;
    for (const [from, to] of parts[k]) {
      ringOffset[r] = v;
      r += 1;
      for (let i = from; i < to; i += 1) {
        x[v] = b.polygon[i][0];
        y[v] = b.polygon[i][1];
        v += 1;
      }
    }
  });
  polygonOffset[golden.buildings.length] = r;
  ringOffset[ringCount] = v;

  return { height, polygonOffset, ringOffset, x, y };
}

// Endpoints become nodes and the rest interior points, which is how graph.json
// splits a polyline. Nodes are not shared between edges here; sampling does
// not care, and the golden gives no node table to reconstruct.
export function graphOf(golden) {
  const n = golden.edges.length;
  const interior = golden.edges.reduce((t, e) => t + e.polyline.length - 2, 0);

  const g = {
    u: new Int32Array(n),
    v: new Int32Array(n),
    x: new Float64Array(2 * n),
    y: new Float64Array(2 * n),
    interiorOffset: new Int32Array(n + 1),
    interiorX: new Float64Array(interior),
    interiorY: new Float64Array(interior),
  };

  let m = 0;
  golden.edges.forEach((e, i) => {
    const line = e.polyline;
    g.u[i] = 2 * i;
    g.v[i] = 2 * i + 1;
    g.x[2 * i] = line[0][0];
    g.y[2 * i] = line[0][1];
    g.x[2 * i + 1] = line[line.length - 1][0];
    g.y[2 * i + 1] = line[line.length - 1][1];

    g.interiorOffset[i] = m;
    for (let k = 1; k < line.length - 1; k += 1) {
      g.interiorX[m] = line[k][0];
      g.interiorY[m] = line[k][1];
      m += 1;
    }
  });
  g.interiorOffset[n] = m;

  return g;
}
