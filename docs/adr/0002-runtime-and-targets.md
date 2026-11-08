# 2. Runtime and targets

Status: proposed (2026-11-08)

## Context

The tool is small, runs for years on low-power hardware, and must stay fast for live values. Efficiency is decided by a few choices, not by the architecture diagram; none is measured yet.

## Decision

- One Rust process: endpoint tasks, storage, API, MQTT, and the embedded SPA (ADR 11).
- Targets, first release: Linux amd64 and arm64, as a static binary, a Docker image and a Home Assistant add-on. Android follows from the same core; nothing may preclude it.
- `unsafe_code` is forbidden workspace-wide. One small glue crate for the WASM build (ADR 5) is the only exception.
- Every dependency is justified by what it replaces. `rusqlite` (bundled SQLite), a minimal HTTPS client on `rustls` for profile and price fetches. The web framework is chosen by measuring `axum` against a lighter one.
- A single-threaded async runtime or a small pool, chosen by measurement.
- Budgets are numbers, not adjectives: resident memory, idle CPU, binary size, and the latency from a register read to the SPA with device time excluded. The first walking skeleton measures them on a Raspberry Pi 3-class board and a mid-range Android phone. A bench in the local gate fails when one is exceeded; budgets ratchet down.
- The gate is local: one serial command, identical before and after merge. Hosted CI returns when the project is stable.

## Considered options

- **Keep the TypeScript engine.** Rejected: duplicate decoders and the memory of a JS runtime.
- **Split poller and server.** Rejected: a second process and a socket between them for no gain at this scale.
- **Go.** Rejected: the profile loader must also compile to WASM for the CLI (ADR 5); one Rust crate serves both.

## Consequences

The WASM glue crate is a standing exception to the `unsafe` rule and is reviewed on every change.
