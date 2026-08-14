---
title: Contributing
description: How to work on SunReye — setup, conventions, and where things live.
---

Contributions are welcome — whether that's a new [inverter profile](/profiles/authoring/),
a feature, or a fix.

:::note
[`CONTRIBUTING.md`](https://github.com/SunReye/SunReye/blob/master/CONTRIBUTING.md) in the
repository root is the full contributor guide: the branch model (`dev` → beta → `master`),
every check CI runs, how to test a branch on real hardware through the beta addon, and the
release procedure. This page is the short orientation.
:::

## Get set up

Follow [Manual Setup](/deploy/manual-setup/) to get the stack running against the simulator.
The [Scripts](/reference/scripts/) reference lists every workspace command.

Before opening a PR, run the checks for the area you touched:

```bash
bun run check         # oxlint + oxfmt
bun run check-types   # TypeScript across the monorepo
```

## Repository conventions

This is a bun + Turborepo monorepo. A few rules worth knowing up front (see the `AGENTS.md`
files throughout the repo for the authoritative, area-specific version):

- **Environment variables** are declared and validated **only** in `packages/env`
  (`server.ts` / `web.ts`). Don't parse `process.env` or add per-package env schemas
  elsewhere. See [Environment Variables](/reference/environment/).
- **Runtime configuration** (inverter connection, MQTT, tariff, profile sources) lives in
  the `app_settings` table with per-key Zod schemas in `packages/db` — not in env. See
  [Settings](/use/settings/).
- **Inverter support is data.** Prefer adding a [profile](/profiles/concept/) over touching
  the engine. New canonical concepts go through the role catalog
  (`packages/inverter-core/src/roles.ts`).
- **Dead code / duplication** — the repo uses `bunx fallow` (`dead-code`, `dupes`, `health`)
  for code-health checks.

## Commit style

Conventional commits: `type(scope): summary`.

- Imperative, specific subject; lowercase types (`feat`, `fix`, `refactor`, `docs`, `test`,
  `chore`); scope when useful.
- One commit = one logical change. Don't mix refactor + feature + formatting noise.

Examples:

- `feat(web): add onboarding empty state`
- `fix(server): prevent duplicate task creation`
- `docs: clarify post-clone setup`

## Where things live

| Area | Path |
| --- | --- |
| Core engine (poll loop, API, MQTT) | `apps/server` |
| Dashboard | `apps/web` |
| Documentation (this site) | `apps/docs` |
| Modbus engine, registry, entity model | `packages/inverter-core` |
| Deye / Sunsynk profile | `packages/inverter-deye-sg05lp3` |
| Profile SDK + CLI | `packages/profile-sdk` |
| Schema, TimescaleDB, runtime settings | `packages/db` |
| Env schema, auth, shared config | `packages/env`, `packages/auth`, `packages/config` |

See the [Architecture Deep-Dive](/reference/internals/) for how these fit together.

## Editing these docs

The docs site is [Astro Starlight](https://starlight.astro.build/) under `apps/docs`. Pages
are Markdown/MDX in `src/content/docs`; the sidebar is configured in `astro.config.mjs`. Run
it with `cd apps/docs && bun dev`.
