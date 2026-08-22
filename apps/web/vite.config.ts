import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { paraglideOptions } from "./i18n.config";

export default defineConfig({
  plugins: [
    tailwindcss(),
    // i18n (Paraglide). Options are shared with the compile script in
    // ./i18n.config.ts; see there for the SPA/hash-router constraints.
    paraglideVitePlugin(paraglideOptions),
    sveltekit(),
  ],
  // Expose PUBLIC_ vars on `import.meta.env` (Vite only exposes VITE_ by
  // default) for any future build-time vars in the `@SunReye/env/web` schema.
  // Runtime vars (PUBLIC_SERVER_URL) go through $env/dynamic/public instead.
  envPrefix: ["VITE_", "PUBLIC_"],
  // LayerChart ships raw .svelte files; bundle it for SSR so Node doesn't try
  // to import .svelte directly (ERR_UNKNOWN_FILE_EXTENSION).
  ssr: {
    noExternal: ["layerchart"],
  },
  // Dev is same-origin like production deployments: the client resolves its
  // API base from the document URL (see src/lib/server-url.ts), so proxy the
  // engine surface to the core server instead of hitting it cross-origin.
  server: {
    // The browser layer mounts components directly.
    //
    // `e2e/period-navigator.spec.ts` imports a harness component out of `e2e/`
    // and mounts it into a live document. /history and /statistics both carry
    // the period navigator for real, so the gestures could be driven through a
    // route — what the harness adds is the two things a route cannot: it prints
    // the `[from, to)` the page would fetch straight off the model, so a case
    // about the WINDOW reads the window instead of inferring it from a chart,
    // and it pins the locale, which is how the 390px row is measured against
    // "Settimana" rather than against English. Doing either through /history
    // means paying for a hundred metric cards' chart mounts per case.
    //
    // A rune cannot run under `bun test` (see apps/web/TESTING.md), so the
    // harness has to be served: SvelteKit narrows Vite's `fs.allow` to `src`,
    // `.svelte-kit` and `node_modules`, and without this the dev server answers
    // "outside of Vite serving allow list" for it.
    //
    // Dev only — `vite build` never reads this — and it widens the dev server by
    // exactly this checkout's own test directory. The e2e origin probe in
    // `e2e/support/global-setup.ts` still works as designed: it asks for a path
    // under THIS project's `src`, which a dev server rooted in another worktree
    // still refuses.
    fs: { allow: ["e2e"] },
    proxy: {
      "/api": "http://localhost:3000",
      "/openapi": "http://localhost:3000",
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
});
