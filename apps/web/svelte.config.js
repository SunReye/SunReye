import adapterNode from "@sveltejs/adapter-node";
import adapterStatic from "@sveltejs/adapter-static";
import { vitePreprocess } from "@rsvelte/vite-plugin-svelte";

// The app is a pure SPA (hash router, SSR off, no server routes), so it can
// ship as static files. Default stays adapter-node (the compose web image
// runs it with Node and reads PUBLIC_SERVER_URL at runtime); the Home
// Assistant addon builds with SVELTEKIT_ADAPTER=static and serves the files
// straight from nginx — there PUBLIC_SERVER_URL must stay unset at build
// time (a static build bakes dynamic public env in) and the client derives
// its API base from the document URL.
const adapter =
  process.env.SVELTEKIT_ADAPTER === "static"
    ? adapterStatic({ fallback: "index.html" })
    : adapterNode();

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // Consult https://svelte.dev/docs/kit/integrations
  // for more information about preprocessors
  preprocess: vitePreprocess(),

  kit: {
    adapter,
    // Hash-based routing keeps the document URL pinned to wherever the app was
    // served from, so the same build works at `/`, behind a direct port, and
    // behind a path-prefixed reverse proxy (Home Assistant ingress serves the
    // app at /api/hassio_ingress/<token>/ — absolute-path navigation would
    // escape the prefix). Implies SSR off and requires a single client bundle.
    // Constraint: no +page.server.ts/+layout.server.ts or per-page options may
    // be added — all data flows through the core client.
    router: { type: "hash" },
    output: { bundleStrategy: "single" },
  },
};

export default config;
