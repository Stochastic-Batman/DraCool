import { sveltekit } from "@sveltejs/kit/vite";


export default {
  plugins: [sveltekit()],
  // shared/constants.json sits above web/
  server: { fs: { allow: [".."] } },
  // MapLibre starts its worker with { type: "module" }, so the bundle it loads
  // has to be one. Vite's default worker format is iife.
  worker: { format: "es" },
  build: {
    // MapLibre is one indivisible 947 kB chunk of someone else's code. It is
    // already split out of the page and loaded on demand (see Map.svelte), so
    // the default 500 kB warning has nothing left to report. Kept just above
    // its real size rather than switched off, so that anything else drifting
    // into that chunk still trips it.
    chunkSizeWarningLimit: 1000,
  },
};
