# SunReye

[![CI](https://github.com/SunReye/SunReye/actions/workflows/ci.yml/badge.svg)](https://github.com/SunReye/SunReye/actions/workflows/ci.yml)
[![Docs](https://github.com/SunReye/SunReye/actions/workflows/docs.yml/badge.svg)](https://github.com/SunReye/SunReye/actions/workflows/docs.yml)
[![coverage](https://raw.githubusercontent.com/SunReye/SunReye/badges/coverage.svg)](https://github.com/SunReye/SunReye/actions/workflows/ci.yml)
[![code style: oxlint + oxfmt](https://img.shields.io/badge/code%20style-oxlint%20%C2%B7%20oxfmt-6E40C9)](https://oxc.rs/)
[![code health: fallow](https://img.shields.io/badge/code%20health-fallow-3FB950)](https://fallow.tools/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3-000000?logo=bun&logoColor=white)](https://bun.sh/)
[![SvelteKit](https://img.shields.io/badge/SvelteKit-5-FF3E00?logo=svelte&logoColor=white)](https://kit.svelte.dev/)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/F0L42337A8)

**A self-hosted monitoring, control, and integration platform for solar / hybrid inverters.**

SunReye polls your inverter over Modbus, stores every reading as time-series data, and gives
you a live dashboard, a typed REST API, and an MQTT bridge with Home Assistant
auto-discovery — all generated from a single description of the inverter.

The core idea: **an inverter is data, not code.** Each supported inverter ships as a
*profile* — a plain description of its Modbus register map plus semantic metadata (what each
value *means*). The dashboard, the REST routes, the MQTT topics, and Home Assistant discovery
all build themselves from that profile. Adding a metric, or a whole new inverter, means
adding data — not touching the engine.

> 📖 **Full documentation lives in the docs site** (`apps/docs`) — installation, usage, the
> REST API, MQTT/Home-Assistant, and the profile-authoring guide. Run it with
> `cd apps/docs && bun dev`.

---

## What it does today

- **Live monitoring** — 1 Hz Modbus polling streamed to the browser over WebSocket; a
  manifest-driven dashboard that renders itself from the active inverter's capabilities.
- **History & analytics** — every sample in **TimescaleDB**, with per-minute / hourly / daily
  rollups and automatic retention. At 1 Hz an inverter writes ~8.5 M rows/day (~5–9 GB
  uncompressed), but compression (~45×) plus tiered retention keep the on-disk footprint bounded
  and flat at **~15 GB per inverter**.
- **SSD-friendly writes** — history writes are batched (one transaction per ~5 s, not per poll)
  and Postgres ships tuned for endurance, cutting bytes written (TBW) **~2–3×** so continuous
  1 Hz logging stays gentle on SSDs and Pi-class storage — see [Requirements](apps/docs/src/content/docs/deploy/requirements.md).
- **Control** — writable settings exposed as validated controls.
- **Costs & tariffs** — import/export tariffs, time-of-use bands, savings, self-sufficiency.
- **Third-party REST API (`/api/v1`)** — auto-generated from the profile, with OpenAPI docs.
- **MQTT bridge** — retained per-entity topics, validated writes, and Home Assistant MQTT
  Discovery.
- **Downloadable profiles** — install inverter profiles from git repos at runtime; a typed
  **profile SDK** to author your own.
- **Built-in simulator** — run the whole stack with no hardware.
- **Auth** — email/password sessions with admin roles and first-run onboarding.

**Supported inverters:** Deye / Sunsynk hybrid (≈99 metrics, ≈38 writable). Add more as data.

---

## Recommended hardware

To connect a real inverter you need a **Modbus TCP** or **Modbus RTU over TCP** gateway on your
network. These are devices the maintainer runs and can vouch for — they work really well:

- **Waveshare Modbus gateway (PoE)** — serial Modbus → **Modbus TCP / RTU over TCP** on
  Ethernet, powered over the same cable. [Search on Amazon](https://amzn.to/452b4DC).
- **DIN-rail-mount gateway** — fits into a DIN rail slot with a little trimming of the window
  plastic: [Non-PoE](https://amzn.to/4eYeVHP) · [PoE](https://amzn.to/4aKZh00).

_The Amazon links are affiliate links — buying through them supports SunReye at no extra cost
to you._ None of this is required; any Modbus TCP / RTU-over-TCP gateway works, and the built-in
simulator needs no hardware at all.

---

## Quick start

```bash
bun install
bun run db:start        # local TimescaleDB via Docker
bun run db:migrate      # schema migrations + hypertable/rollups
bun run dev             # start everything
```

Open [http://localhost:5173](http://localhost:5173) for the dashboard; the API + OpenAPI docs
are at [http://localhost:3000](http://localhost:3000) (`/openapi`). `INVERTER_SIMULATE`
defaults to `true`, so no inverter is needed.

See the docs for [Manual Setup](apps/docs/src/content/docs/deploy/manual-setup.md),
[Docker Compose](apps/docs/src/content/docs/deploy/docker.md), and the full
[Environment Variables](apps/docs/src/content/docs/reference/environment.md) reference.

---

## Architecture

```
Inverter (Modbus TCP)  ──►  Core engine (Elysia)  ──►  TimescaleDB (time-series)
        │                        │  ├─ WebSocket   ──►  Web dashboard (SvelteKit)
        │                        │  ├─ REST /api/v1 ──►  Third-party integrations
        └── (or simulator)       │  └─ MQTT bridge  ──►  Home Assistant / brokers
                                 ▲
                    Inverter profile (data)
             register map + semantic metadata  ──►  drives every surface above
```

```
SunReye/
├── apps/
│   ├── web/          # SvelteKit dashboard (manifest-driven UI)
│   ├── server/       # Elysia core engine: poll loop, WS, REST /api/v1, MQTT bridge
│   └── docs/         # Astro Starlight documentation site
└── packages/
    ├── inverter-core/         # Modbus engine, profile registry, entity model
    ├── inverter-deye-sg05lp3/ # Deye / Sunsynk profile package
    ├── profile-sdk/           # Profile authoring: validate / coverage / scaffold
    ├── db/                    # Drizzle schema + TimescaleDB + runtime settings
    ├── auth/ env/ config/     # Auth, env schema (single source of truth), tooling
```

**Stack:** TypeScript · Bun · Turborepo · SvelteKit 5 + Tailwind v4 · Elysia · Drizzle +
PostgreSQL/TimescaleDB · Better-Auth · MQTT.

For the boot sequence, the registry seam, and the entity model, see the
[Architecture Deep-Dive](apps/docs/src/content/docs/reference/internals.md).

---

## Branching and releases

`master` is what is released. `dev` is the integration branch: feature branches open PRs
into `dev`, and one PR from `dev` to `master` cuts a release, where release-please raises
the version PR and the Docker/addon images build from the release tag.

**Merge the `dev` → `master` PR with a merge commit, never a squash.** release-please
builds the changelog from the individual conventional commits; squashing the release PR
collapses a whole release into one subject line and loses it.

### Beta addon channel

Every push to `dev` builds an amd64 addon image and publishes it as **SunReye (beta)** — a
second entry (slug `sunreye-beta`) in the same add-on repository you already added to Home
Assistant, so testing unreleased work needs no new repository URL. Hit *Update* on it to
pull the newest beta.

Betas are versioned `beta.<YYYYMMDD>-<short sha>`, the scheme
[evcc](https://github.com/evcc-io/evcc) uses for its nightly addon — deliberately not
semver, since a beta cannot know whether the release it leads to will be a major, a minor,
or a patch. The date and commit say what the image actually is. Ordering does not matter:
the Supervisor offers an update whenever the published version simply *differs* from the
installed one. Superseded beta tags are pruned from GHCR, keeping the newest few.

It installs alongside the stable addon and keeps its own `/data` and its own embedded
postgres, so a beta cannot touch production data. It ships `boot: manual` on purpose: most
inverters accept a single Modbus TCP connection at a time, so stop the stable addon (or run
the beta with `inverter_simulate`) before starting it.

Everything under `sunreye-beta/` is generated by `scripts/sync-beta-addon.mjs` from
`sunreye/` — never hand-edit it. The manifest has to be committed on `master` because the
Supervisor only ever reads an add-on repository's default branch, which is also why the
beta cannot simply live on `dev`.

---

## Roadmap

**Shipped:** cost tracking & tariffs · UI-based runtime configuration · downloadable
inverter profiles + authoring SDK · admin roles & onboarding · simulator.

**Planned:** threshold alerts & notifications · scheduled reports & data export ·
tariff-aware charge/discharge automation · multi-inverter aggregation · installable PWA ·
community profile catalog.

See the [full roadmap](apps/docs/src/content/docs/reference/roadmap.md).

---

*Bootstrapped with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack).*
