import { createEnv } from "@t3-oss/env-core";

// fallow-ignore-next-line unused-export -- placeholder entry with an empty client schema, so it has no importer yet by construction; packages/env/AGENTS.md requires the `./web` package export be preserved for future build-time PUBLIC_ vars rather than deleted and re-added
export const env = createEnv({
  clientPrefix: "PUBLIC_",
  // No schema-validated browser vars right now. `PUBLIC_SERVER_URL` (optional
  // override for split-origin deployments) is consumed through SvelteKit's
  // `$env/dynamic/public` in apps/web/src/lib/server-url.ts — it must be read
  // at runtime, not inlined at build time, so it can't go through this
  // import-time schema. Add future build-time PUBLIC_ vars here.
  client: {},
  runtimeEnv: (import.meta as any).env,
  // `process` is absent in the browser bundle; guard before touching it so the
  // schema can be imported client-side as well as during SSR.
  skipValidation: typeof process !== "undefined" && !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
