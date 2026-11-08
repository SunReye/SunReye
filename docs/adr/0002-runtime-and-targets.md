# 2. Runtime and targets

Status: accepted (2026-11-08), amended (2026-11-08)

## Context

The tool is small, runs for years on low-power hardware, and must stay fast for live values. Efficiency is decided by a few choices, made here from known costs rather than measured.

## Decision

- One Rust process: endpoint tasks, storage, API, MQTT, and the embedded SPA (ADR 11).
- Targets, first release: Linux amd64 and arm64, as a static binary, a Docker image and a Home Assistant add-on. Android follows from the same core; nothing may preclude it.
- `unsafe_code` is denied workspace-wide. One small glue crate for the WASM build (ADR 5) is the only exception, through a single `#[expect(unsafe_code, reason = "…")]`; `forbid` could not be lifted for it.
- Every dependency starts at its latest release and is justified by what it replaces. `rusqlite` (bundled SQLite), a minimal HTTPS client on `rustls` for profile and price fetches. `axum` with default features off for HTTP.
- `tokio` on a single thread for all I/O. One dedicated thread owns the SQLite connection and is fed by a channel, so a slow write never stalls polling.
- Release build: `opt-level = "s"`, fat LTO, one codegen unit, `panic = "abort"`, stripped, statically linked against musl. The workload waits on devices, so size beats peak speed.
- Design rules instead of budgets: no allocation per poll, live values served from memory, every queue and buffer bounded (one bucket per device), history responses bounded (ADR 9), SPA routes code-split (ADR 11).
- Logs go through `tracing` to stderr, where journald or Docker keep them. A bounded in-memory buffer of the last 2,000 lines feeds the SPA's log screen. The core writes no log files, sparing the flash.
- The gate is local: one serial command, identical before and after merge. Hosted CI returns when the project is stable.

## Considered options

- **Keep the TypeScript engine.** Rejected: duplicate decoders and the memory of a JS runtime.
- **Split poller and server.** Rejected: a second process and a socket between them for no gain at this scale.
- **Go.** Rejected: the profile loader must also compile to WASM for the CLI (ADR 5); one Rust crate serves both.

## Consequences

The WASM glue crate is a standing exception to the `unsafe` rule and is reviewed on every change.
