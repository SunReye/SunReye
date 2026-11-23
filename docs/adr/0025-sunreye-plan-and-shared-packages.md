# 25. SunReye Plan and the shared packages

Status: accepted (2026-11-19), amended (2026-11-20, 2026-11-23): licence: design accepted; the packages' extraction blocks the first release, publishing follows Plan's

## Context

Installers plan a PV plant before it exists, and the homeowner monitors it afterwards. The `pv` crate, the module catalogue and the 3D house builder (ADRs 17, 20) already do most of a planner's work, and a plan made with them is a PV layout the core can run unchanged. The owner wants to sell planning to installers and keep monitoring free.

## Decision

**Two products, one layout.** SunReye Home is this repository's core and app. SunReye Plan is a hosted planner for installers, sold per seat. A plant planned in Plan reaches Home as a plant document (ADR 26), so the planned layout becomes the monitored one.

**Where Plan lives.** A separate private repository with its own ADRs and glossary. It runs on Cloudflare, not on the core: the core is one plant per install (ADR 1), and an installer needs organisations and many projects. Decisions that change a contract both products read stay here: the scene and layout schema (ADRs 17, 20), the plant document (ADR 26), the datasheet catalogue (ADR 27), the cloud identity (ADR 16) and the PV and economics models (ADRs 17, 28).

**Shared packages.** This repository publishes what Plan consumes, versioned with the core:

| Package | Holds |
|---|---|
| `@sunreye/pv-wasm` | the `pv` crate's browser build (ADR 17), and a loader that instantiates it from bytes and types its answers, which read and return the types of `@sunreye/scene` (2026-11-23) |
| `@sunreye/scene` | the scene, layout and plant document types, generated from the crates; a roof face's key, from its block and its face as ADR 20 names it, so every view selects a face by the same key (2026-11-23) |
| `@sunreye/builder` | the 3D house builder's components (ADR 20) |
| `@sunreye/catalogue` | the module and datasheet catalogues (ADRs 17, 27) |
| `@sunreye/tokens` | the look's design tokens (ADR 21) |
| `@sunreye/ui` | the kit components the builder uses and the kit's Tailwind sheet (ADRs 11, 21) |

The builder moves out of `apps/web` into `packages/builder` before the first release, so Home is its first consumer and Plan its second. Publishing to npm starts when Plan ships.

**Until then** (2026-11-20). Plan's checkout stands beside this repository's in one folder, which is no workspace of its own, and Plan depends on the packages by path. On a developer's machine they are linked, so an edit here shows in Plan without an install. Plan's gate checks this repository out at a commit Plan names and builds the packages from it, the `pv` crate's browser build included. Each repository keeps its own root, lockfile and gate, and a change to a package is committed here, never from Plan. A package is built as it will be published, so moving to npm changes Plan's dependency lines and nothing else.

**Between the packages (2026-11-23).** A package that needs another `@sunreye` package names it as a peer dependency, its range the major version, never as a dependency or a `workspace:*` dev dependency: Bun resolves a folder dependency's dev dependencies too, and `workspace:*` fails outside this workspace. So a consumer supplies each package once, and every package reads that one copy; here the workspace links the peer. Bun 1.4 fills a peer from the registry, never from a folder the consumer names, so a consumer that installs by path also overrides each `@sunreye` package with its path, and type-checks with `preserveSymlinks`, as Bun links each installed file back into this repository. Moving to npm drops both.

**Crates as well as packages (2026-11-23).** Plan's whole engine is Rust (Plan's ADR 3), and the engines only a planner needs are private crates in Plan's repository that depend on this repository's `pv`, `economics` and catalogue crates by path, as Plan's packages do. So the crates' public interfaces are a contract with a second consumer too. Whatever the builder gains for Plan (the simulation's views: moving shadows over the year, irradiance on a face, a module's shading loss, the sun's path, the loss chain) Home's builder shows as well; imagery and building data do not come with it.

**Licence (2026-11-23).** From `v5` onward this repository is licensed under PolyForm Shield 1.0.0: anyone may use, change and share it for any purpose except to provide a product that competes with ours. It never turns into another licence. The owner does not want the crates taken and a product built around them, and AGPL allows exactly that to anyone who publishes their changes.
- *Why not keep the planner-grade parts private instead.* The owner wants what Plan gains to reach Home: the roof tracing, the full yield simulation and its views are in this repository and a homeowner uses them. The licence protects them; what Home never needs stays in Plan's private repository (Plan's ADR 11).
- *What stays open.* The device profiles and the profile SDK (`profiles/`, `packages/sdk`, the `profile` crates) may be used under AGPL-3.0-only or under PolyForm Shield, as the user chooses: they live from other people's contributions. `LICENSING.md` says which part is under what.
- *What stays private.* The collected datasheet catalogue of inverters and batteries is Plan's; this repository holds its format and the module catalogue (ADR 27).
- *What is already out.* Everything published before the change remains usable under AGPL-3.0-only. Nothing planner-grade (the year's run, the tracing tool, the household model, the simulation's views) is pushed to a public branch before the `LICENSE` file changes.
- *Done (2026-11-23).* The owner read the licence and confirmed it fits. `LICENSE` holds its text as published, the `license` fields follow, and cargo-deny no longer allows an AGPL dependency.
- *Plan* uses the crates and packages as their owner. An outside contribution is accepted only under an agreement that leaves the owner free to license it.

**The UI kit (2026-11-23).** The kit components the builder uses, directly or through the app's own components, are `@sunreye/ui`, so the builder looks and responds the same in both products. The builder is drawn with the kit: every button, row, menu and sheet in it is a kit component, and a planner that brought its own would drift from Home's look with each change to either.
- *What it holds.* Alert, button, calendar, card, checkbox, dialog, drawer, dropdown menu, input, item, popover, pressable, separator, slider, spinner, toggle and toggle group; the helpers they share (class merging, haptics, the sliding indicator, the motion ease); and the kit's Tailwind sheet: its utilities, variants, theme mapping and motion tokens. The rest of the kit stays in `apps/web` and moves when a shared component first needs it.
- *How it ships.* As Svelte and TypeScript sources, which a consumer compiles with Svelte's Vite plugin. A consumer imports Tailwind, `@sunreye/tokens` and the package's sheet, and points Tailwind's `@source` at the package. Svelte is a peer dependency, so one runtime serves the package and its consumer.
- *What stays the app's.* Components that carry the app's messages or API types (the value editor, drill-in, the date field) are not the kit; they move with the builder.

**Imagery stays out of Home.** Plan loads aerial imagery and building models by address; Home fetches no map data (ADR 20). A plant document carries finished geometry and never imagery.

## Open before build

- Whether a linked package runs with one Svelte runtime in the browser: the trial type-checked and built, and ran nothing.

## Considered options

- **Planning inside the core.** Rejected: multi-tenancy would bend a design built on one plant per install.
- **Plan in this repository.** Rejected: it would be public like the rest, or a second licence in one tree.
- **Business Source License, Functional Source License.** Rejected: both turn each release into an open licence after a period, which the owner does not want.
- **PolyForm Noncommercial with a permission for commercial monitoring.** Rejected: it needs wording of our own, and forbids an installer's own use, which the owner does not mind.
- **AGPL with the valuable parts private in Plan.** Rejected: Home would not get them.
- **The builder takes the kit from its consumer.** Rejected: each consumer would supply its own buttons, menus and sheets to the builder's interface, so the builder would look like whichever app hosts it, and keeping the two alike would be a copy to maintain by hand.
- **A git submodule instead of packages.** Rejected: Plan could import any file here, so the packages' interfaces would never harden; a change made inside the submodule would pass by this repository's gate; and every shared change would need its pin moved in Plan.
- **One workspace above both repositories.** Rejected: each root has its own dependency catalogue and lockfile, and an install from a root above them fails on Plan's catalogue (tried 2026-11-20).
- **Ground-mounted parks in Plan.** Rejected: project developers are another customer with another workflow, and nothing is handed to a Home. Plan stops at what an installer builds: roofs, several buildings of one plant, racks on flat roofs and small ground fields (ADR 20).
- **Homeowners as the paying audience.** Rejected: installers plan every day and pay for the offer; homeowners keep Home's builder without imagery.

## Consequences

The builder's interface becomes a published contract: a breaking change is a major version of its package. The scene schema now serves a second writer, so the core's refusal of unknown fields (ADR 20) is what keeps an older Home from misreading a newer plan.
