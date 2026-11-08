# 13. Packaging and release

Status: accepted (2026-11-08), amended (2026-11-08)

## Context

v4 shipped images, an add-on, an appliance and an Android build, each with its own long tail. Hosted CI minutes are being saved until the project is stable.

## Decision

- **Layout.** `crates/` (Rust: core, profile crate, WASM glue), `apps/web` (SPA), `apps/cloud` (relay, TypeScript on Cloudflare, ADR 16), `packages/` (npm: authoring API, CLI, WASM), `profiles/` (official profiles), `docs/adr/`.
- **First release.** A static Linux binary for amd64 and arm64 with a systemd unit, a multi-arch Docker image, and a Home Assistant add-on that wraps the image. The NixOS appliance and the Android app follow; no release gate depends on them.
- **Home Assistant add-on.** A skeleton test decides ingress: the SPA under a real ingress prefix. Pass: the add-on ships with ingress and a sidebar entry, and trusts HA's login (ADR 9). Fail: it exposes the core's own port with its own login. The core serves plain HTTP; TLS is a reverse-proxy job.
- **Core release.** Semver, cut by one local `bun run release` that builds the artifacts and the image, tags, and publishes. The changelog comes from conventional commits.
- **Profiles and npm.** Profiles publish separately (ADR 8). The npm package releases only when the schema, the capability table or a decoder changes.
- **Gate.** One serial command, the same before and after merge: unit tests, `cargo test`, the WASM build and its tests, lint and format. Hosted CI returns when the project is stable and runs the same command.
- **Docs.** Plain Markdown under `docs/`, no docs site in the first release.

## Considered options

- **release-please and hosted publishing.** Rejected for now: it needs hosted CI.
- **All targets in the first release.** Rejected: each target needs its own verification.

## Consequences

A Home Assistant add-on repository is read by Supervisor from its default branch, so the add-on manifest must live there when the add-on ships.
