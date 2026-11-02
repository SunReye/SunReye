# packages/config

Shared `tsconfig.base.json`; no runtime code.

- A change here reaches every workspace: check dependents, then `bun run typecheck` from the repo root.
- One shared rule beats a copy per package.
- New exports or files also go in `package.json`.
