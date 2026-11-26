# 36. Monorepo

Status: accepted (2026-11-26)

## Context

ADR 25 kept SunReye Plan, the installers' app, in a second repository that reads this one's crates and packages by path from a checkout beside it. Two roots, two lockfiles and two gates made every shared change a two-step landing, and the second checkout had to sit at a commit the other named. The owner now wants one repository for both.

## Decision

**One public repository.** This repository becomes the monorepo, under PolyForm Shield (ADR 25). Apps live under `apps/`, what they share under `crates/` and `packages/`. Home is `apps/home`; SunReye Plan, the installers' app, joins later as `apps/plan`.

**Everything is public except secrets.** Keys, tokens and credentials stay out of the tree; everything else, prices and prompts included, is committed.

**Plan joins without history.** When Plan is reopened it moves in as one commit, after a secrets scan of what moves; its earlier history stays in its own repository.

**Layout.**

| Path | Holds |
|---|---|
| `apps/home/core` | the core: the one process, its binary crate `sunreye-core` (ADRs 1, 2) |
| `apps/home/web` | Home's SPA, which the core embeds (ADR 11) |
| `crates/` | shared Rust: `pv`, `pv-wasm`, `profile`, `profile-wasm`, `synth`; `scene`, `economics` (ADR 28) and `forecast` (ADR 38) when built |
| `packages/` | shared TypeScript: `builder`, `scene`, `catalogue`, `ui`, `tokens`, `sdk`, `pv-wasm` (ADR 25) |

- *Why `core` and `web`.* An app's folder holds one folder per deliverable, named for what it is in this repository's words: the glossary and the ADRs call the Rust process the core, and its crate is `sunreye-core`. A new name such as `hub` would be a second word for one thing.
- *Why the core is not under `crates/`.* `crates/` holds what more than one app may read. The core is Home's alone: it embeds Home's SPA and serves one plant (ADR 1).

**One workspace each.** One bun workspace (`apps/*/*`, `packages/*`) and one Cargo workspace (`apps/home/core`, `crates/*`, `packages/catalogue`), one lockfile each.

**One gate.** `bun run gate` stays the only check (ADR 13), run from the root; it checks what a change touches through its cached steps.

**Agent rules.** The root `AGENTS.md` holds what applies to the whole repository; `apps/home/AGENTS.md` holds what applies only to Home.

## Considered options

- **Two repositories, read by path** (ADR 25). Rejected: a shared change lands twice and passes two gates, and the second consumer pins a commit by hand.
- **Plan in its own private repository, Home's crates published to npm and crates.io.** Rejected: every shared change waits for a release, and both apps move on the same core.
- **The core under `crates/`.** Rejected: it is Home's app, not a shared crate.

## Consequences

Paths changed: `apps/web` is `apps/home/web`, `crates/core` is `apps/home/core`. Branches cut before the move carry the old paths; git follows the renames when they merge. ADR 13's layout and ADR 25's placement of Plan are amended to point here.
