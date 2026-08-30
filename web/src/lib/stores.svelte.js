// The roadmap calls this lib/stores.js; Svelte 5 runes only work inside a
// .svelte.js module, so the extension is the one part that had to change.
//
// The three tiers of roadmap Section 1.2 are visible here as three fields with
// three different lifetimes: `when` invalidates `shade`, which is the
// expensive one and goes to the worker; `w` invalidates only `route`, which is
// a re-weight and a search on the main thread; `from` and `to` invalidate
// `route` alone as well.

// Snapped to the time control's own step, so the slider and the clock beside
// it agree from the first paint. Every IANA offset is a whole quarter hour, so
// a multiple of five minutes survives the trip into any city's zone.
const STEP_MS = 5 * 60 * 1000;

export const app = $state({
  when: new Date(Math.round(Date.now() / STEP_MS) * STEP_MS),

  // Section 6.1: how much extra walking is worth one metre of sun avoided. At
  // 0 the multiplier is identically 1 and this is an ordinary shortest path.
  w: 0.5,

  from: null,
  to: null,
  shade: null,
  route: null,
});
