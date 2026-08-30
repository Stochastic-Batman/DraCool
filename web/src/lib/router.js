// Roadmap Section 1.6 put the network in graphology and ran A* over a flat
// view of it. The flat view is the only thing the search ever reads, so the
// library was measured out again: building it cost 284 ms per load on Tbilisi
// against about 10 ms to fill these arrays straight from the columnar graph,
// for a structure nothing in the browser queries. It stays in the test suite,
// where its Dijkstra is an independent oracle for the search below, and that
// is the whole of what it was earning.
//
// A* is ours because graphology-shortest-path ships Dijkstra and not A*, while
// Proposition 3 exists precisely to license A* with a Euclidean heuristic.

// Adjacency in CSR: node -> its arcs, each carrying the neighbour and the edge
// index the weight lives at. Undirected, so every edge appears from both ends;
// the walking network has no one-way streets to model.
export function adjacency({ u, v, x }) {
  const n = x.length;
  const offset = new Int32Array(n + 1);
  for (let e = 0; e < u.length; e += 1) {
    offset[u[e] + 1] += 1;
    offset[v[e] + 1] += 1;
  }
  for (let i = 0; i < n; i += 1) offset[i + 1] += offset[i];

  const to = new Int32Array(offset[n]);
  const via = new Int32Array(offset[n]);
  const at = offset.slice(0, n);
  for (let e = 0; e < u.length; e += 1) {
    to[at[u[e]]] = v[e];
    via[at[u[e]]] = e;
    at[u[e]] += 1;
    to[at[v[e]]] = u[e];
    via[at[v[e]]] = e;
    at[v[e]] += 1;
  }

  return { offset, to, via };
}

// Open question 2's v1 answer: snap a click to the nearest node. Snapping to
// the nearest point on an edge is better and needs edge splitting, which is
// deferred. A linear scan is under a millisecond even on the largest city, so
// there is no index to keep in step with anything.
export function nearestNode(x, y, px, py) {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < x.length; i += 1) {
    const dx = x[i] - px;
    const dy = y[i] - py;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// Lazy deletion rather than a decrease-key: a node is pushed again when its
// distance improves and skipped if it is popped already closed. Each arc can
// push at most once, so the heap is bounded and allocated with the scratch.
function push(h, f, node) {
  let i = h.size;
  h.size += 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h.f[p] <= f) break;
    h.f[i] = h.f[p];
    h.node[i] = h.node[p];
    i = p;
  }
  h.f[i] = f;
  h.node[i] = node;
}

function pop(h) {
  const top = h.node[0];
  h.size -= 1;
  if (h.size > 0) {
    const f = h.f[h.size];
    const node = h.node[h.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= h.size) break;
      if (c + 1 < h.size && h.f[c + 1] < h.f[c]) c += 1;
      if (h.f[c] >= f) break;
      h.f[i] = h.f[c];
      h.node[i] = h.node[c];
      i = c;
    }
    h.f[i] = f;
    h.node[i] = node;
  }
  return top;
}

export function scratch({ offset, to }) {
  const n = offset.length - 1;
  return {
    dist: new Float64Array(n),
    fromNode: new Int32Array(n),
    fromEdge: new Int32Array(n),
    closed: new Uint8Array(n),
    heap: { f: new Float64Array(to.length + 1), node: new Int32Array(to.length + 1), size: 0 },
  };
}

// h(v) = ||x_v - x_z||, admissible and consistent under this cost by
// Proposition 3. Metres throughout: the heuristic and the weights have to be
// in the same units or the bound means nothing.
export function astar(view, cost, x, y, source, target, work) {
  const { offset, to, via } = view;
  const s = work ?? scratch(view);
  const { dist, fromNode, fromEdge, closed, heap } = s;

  dist.fill(Infinity);
  closed.fill(0);
  heap.size = 0;

  const tx = x[target];
  const ty = y[target];

  dist[source] = 0;
  fromNode[source] = -1;
  fromEdge[source] = -1;
  push(heap, Math.hypot(x[source] - tx, y[source] - ty), source);

  while (heap.size > 0) {
    const node = pop(heap);
    if (closed[node]) continue;
    if (node === target) break;
    closed[node] = 1;

    for (let i = offset[node]; i < offset[node + 1]; i += 1) {
      const next = to[i];
      if (closed[next]) continue;
      const d = dist[node] + cost[via[i]];
      if (d < dist[next]) {
        dist[next] = d;
        fromNode[next] = node;
        fromEdge[next] = via[i];
        push(heap, d + Math.hypot(x[next] - tx, y[next] - ty), next);
      }
    }
  }

  if (dist[target] === Infinity) return null;

  const nodes = [target];
  const edges = [];
  for (let at = target; at !== source; at = fromNode[at]) {
    edges.push(fromEdge[at]);
    nodes.push(fromNode[at]);
  }
  nodes.reverse();
  edges.reverse();

  return { nodes, edges, cost: dist[target] };
}
