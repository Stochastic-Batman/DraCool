import { sveltekit } from "@sveltejs/kit/vite";


export default {
  plugins: [sveltekit()],
  // shared/constants.json sits above web/
  server: { fs: { allow: [".."] } },
  // MapLibre starts its worker with { type: "module" }, so the bundle it loads
  // has to be one. Vite's default worker format is iife.
  worker: { format: "es" },
};
