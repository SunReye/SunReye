# Home

SunReye Home: the core (`core/`, the Rust process, crate `sunreye-core`) and the homeowner's app (`web/`, the SPA). The root `AGENTS.md` applies too.

- The core embeds the SPA's build (ADR 11): run `bun run --cwd apps/home/web build` before any cargo step that compiles `sunreye-core`.
- A screen follows `web/DESIGN.md` (ADR 21).
- The core's API is a contract (ADR 9): after changing a route, `bun run --cwd apps/home/web api` regenerates `core/openapi.json` and the SPA's types.
