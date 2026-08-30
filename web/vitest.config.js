// No SvelteKit plugin: these suites test lib/ modules, which are plain
// JavaScript and import nothing from $app. Loading the whole kit here would
// make a units test wait on a build.
export default {
  test: {
    include: ["tests/**/*.test.js"],
  },
  resolve: {
    alias: { $lib: new URL("./src/lib", import.meta.url).pathname },
  },
};
