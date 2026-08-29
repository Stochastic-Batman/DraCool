import adapter from "@sveltejs/adapter-static";


export default {
  kit: {
    adapter: adapter({ fallback: null }),
    paths: { base: process.env.BASE_PATH ?? "", relative: true },
  },
};
