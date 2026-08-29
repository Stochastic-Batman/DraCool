// adapter-static needs every route prerendered. There is nothing to render on
// a server anyway: the map, the sun and the router are all browser-side, and
// the city data is fetched at runtime.
export const prerender = true;
export const ssr = false;
