# 2. A Rust core replaces the TypeScript engine

Status: accepted (2026-11-01)

## Context

SunReye should run without a dedicated server: on a wall tablet, on an ESP32-P4, and on the existing
Linux hosts. The engine cannot follow it there:

- **Runtime.** Bun ships Android builds since 1.3.14, but every 1.4.x release up to 1.4.4 still dies
  under the Android app seccomp filter (`pidfd_open` #46771, `statx` #46772, fixed only on `main`), and
  no JavaScript runtime fits a microcontroller.
- **Storage.** TimescaleDB and `timescaledb_toolkit` exist for neither Android nor ESP-IDF; 98 of 177
  server files import the database layer, with no storage seam.
- **Weight.** The Bun runtime alone is tens of MB before app code; the add-on also runs Postgres.

Axum 0.8 on tokio runs on ESP-IDF RISC-V today (sjm42/esp32temp); tokio and rustls run on the P4
(n0-computer/iroh-esp32-examples).

## Decision

Rewrite the engine in Rust as one core for every edition: Linux PC first, then the Home Assistant add-on
(aarch64), an Android tablet app (Kotlin foreground service hosting the core over JNI, WebView UI) and
the ESP32-P4 (ESP-IDF `std`, 32 MB PSRAM). The Svelte web app, `profile-sdk` and the docs stay in
TypeScript; the SPA is embedded in the binary.

The TypeScript engine (`apps/server`, `packages/db`, `packages/inverter-core`, `packages/auth`,
`packages/env`) is feature-frozen from this date. Fixes ship from `release/2.x`; the engine is deleted
from `dev` when the Rust core reaches beta.

## Consequences

- About 53k lines of engine and 66k lines of tests are not ported. Their edge cases (DST, midnight,
  counter restarts, Solarman framing quirks) survive only as language-neutral oracle fixtures generated
  from the TypeScript engine before it is deleted; golden values come from those fixtures.
- Shelved until the core regains control: the MPC optimizer (#197), EVCC integration Part B,
  negative-price windows.
- Standards: SunReye's TDD rules in full, plus the Rust lints, `clippy.toml` thresholds, rustfmt and
  toolchain pin of `../axlink`. `unsafe_code` is forbidden everywhere except the JNI crate.
- API: Axum 0.8 with `utoipa` / `utoipa-axum`; the SPA moves from Eden to `openapi-typescript` +
  `openapi-fetch`. Endpoint paths and shapes stay, so route smoke keeps reading the OpenAPI listing.
  axlink is evaluated separately and adopted only after beta.
- Profiles: official profiles compiled in; other sources are a base URL plus a path to an `index.json`,
  fetched over HTTPS. No git client.
- Configuration: a few startup flags (listen address, data directory, log level); everything else is a
  setting stored by the core. No Rust counterpart of `packages/env`.
