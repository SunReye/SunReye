import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit({ adapter: adapter({ fallback: "index.html" }) })],
  // They ship Svelte and TypeScript sources, which the dev server's pre-bundling cannot read.
  optimizeDeps: { exclude: ["@sunreye/builder", "@sunreye/ui"] },
  resolve: {
    // Bun links each installed file back into SunReye Home: resolve every import from this
    // install, so Svelte, three.js and the builder's other peers load once.
    preserveSymlinks: true,
    // The builder's own folder links its sibling packages too: read them from this install.
    dedupe: ["@sunreye/catalogue", "@sunreye/pv-wasm", "@sunreye/scene", "@sunreye/ui"],
  },
});
