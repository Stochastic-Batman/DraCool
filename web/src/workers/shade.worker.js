import { occluders, shade } from "../lib/shade.js";


// The shade tier of roadmap Section 1.2. It is the only tier that costs real
// time -- on the order of a million ray queries for a city -- and the only one
// the user can trigger by dragging something, so it runs here and not on the
// thread that has to keep the map moving.
let occ = null;
let samples = null;

onmessage = ({ data }) => {
  if (data.scene) {
    occ = occluders(data.scene.buildings);
    samples = data.scene.samples;
    postMessage({ ready: true });
    return;
  }

  const started = performance.now();
  const sigma = shade(samples, occ, data.sun, undefined, data.stride);
  // Transferred, not copied: a Float32Array per edge is half a megabyte on a
  // city, and it is dead here the moment it is sent.
  postMessage(
    { sigma, ms: performance.now() - started, seq: data.seq, stride: data.stride },
    [sigma.buffer],
  );
};
