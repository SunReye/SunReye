# 25. SunReye Plan and the shared packages

Status: accepted (2026-11-19): design accepted; the packages' extraction blocks the first release, publishing follows it

## Context

Installers plan a PV plant before it exists, and the homeowner monitors it afterwards. The `pv` crate, the module catalogue and the 3D house builder (ADRs 17, 20) already do most of a planner's work, and a plan made with them is a PV layout the core can run unchanged. The owner wants to sell planning to installers and keep monitoring free.

## Decision

**Two products, one layout.** SunReye Home is this repository's core and app. SunReye Plan is a hosted planner for installers, sold per seat. A plant planned in Plan reaches Home as a plant document (ADR 26), so the planned layout becomes the monitored one.

**Where Plan lives.** A separate private repository with its own ADRs and glossary. It runs on Cloudflare, not on the core: the core is one plant per install (ADR 1), and an installer needs organisations and many projects. Decisions that change a contract both products read stay here: the scene and layout schema (ADRs 17, 20), the plant document (ADR 26), the datasheet catalogue (ADR 27), the cloud identity (ADR 16) and the PV and economics models (ADRs 17, 28).

**Shared packages.** This repository publishes what Plan consumes, versioned with the core:

| Package | Holds |
|---|---|
| `@sunreye/pv-wasm` | the `pv` crate's browser build (ADR 17) |
| `@sunreye/scene` | the scene, layout and plant document types, generated from the crates |
| `@sunreye/builder` | the 3D house builder's components (ADR 20) |
| `@sunreye/catalogue` | the module and datasheet catalogues (ADRs 17, 27) |
| `@sunreye/tokens` | the look's design tokens (ADR 21) |

The builder moves out of `apps/web` into `packages/builder` before the first release, so Home is its first consumer and Plan its second. Publishing to npm starts when Plan's build does.

**Licence.** Everything here stays AGPL-3.0-only. The owner, the sole author, also offers the shared crates and packages under a commercial licence, which Plan uses. An outside contribution is accepted only under a contributor licence agreement that keeps both licences possible.

**Imagery stays out of Home.** Plan loads aerial imagery and building models by address; Home fetches no map data (ADR 20). A plant document carries finished geometry and never imagery.

## Considered options

- **Planning inside the core.** Rejected: multi-tenancy would bend a design built on one plant per install.
- **Plan in this repository.** Rejected: it would be AGPL like the rest, or a second licence in one tree.
- **A git submodule instead of packages.** Rejected: it ties Plan to this repository's history and gate.
- **Ground-mounted parks in Plan.** Rejected: project developers are another customer with another workflow, and nothing is handed to a Home. Plan stops at what an installer builds: roofs, several buildings of one plant, racks on flat roofs and small ground fields (ADR 20).
- **Homeowners as the paying audience.** Rejected: installers plan every day and pay for the offer; homeowners keep Home's builder without imagery.

## Consequences

The builder's interface becomes a published contract: a breaking change is a major version of its package. The scene schema now serves a second writer, so the core's refusal of unknown fields (ADR 20) is what keeps an older Home from misreading a newer plan.
