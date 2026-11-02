# packages/env

Single source of truth for env vars: `@t3-oss/env-core` + `zod`, validated at import time.

- `src/web.ts`: public, browser-safe schema; vars start `PUBLIC_`.
- `src/server.ts`: private server schema.
- Add a var here first, to the file that owns it, only when an app uses it. Delete dead vars.
- No env schema or direct `process.env` validation outside this package.
- `runtimeEnv` reads the real env; the schema validates its shape.
- No server vars: keep `server: {}` so the package export stays.
- Export paths change → update `package.json`.

Example env: `apps/web/.env.example`.
