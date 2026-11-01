# 6. One dependency set for every target

Status: accepted (2026-11-01); amended the same day: ESP-IDF dropped, Linux and Android remain

## Context

The core targets Linux and Android (`aarch64-linux-android`). Per-target libraries multiply code paths and
the bugs in them. The tokio stack already spans both: Axum 0.8, `std::fs`, plain TCP for Modbus and MQTT.

The ESP32-P4 (ESP-IDF `std`, `riscv32imafc-esp-espidf`) was a third target. Before any measurement showed
the core fits it, it already cost a pinned nightly with `-Zbuild-std`, a 1–2 GB ESP-IDF toolchain on every
machine running `scripts/ci`, a ban on `AtomicU64`, a mandatory single-threaded runtime and a PSRAM write
buffer in front of the store. It is dropped; bringing a microcontroller back takes a new ADR.

## Decision

Every crate in the workspace builds for Linux and Android. Code differs per target only in runtime startup,
network bring-up and the Android Kotlin/JNI shell.

- No trait or seam until a second implementation exists.
- Rules fixed from the start: bounded memory, no process spawning (the Android app sandbox).
- Single-threaded tokio by default; a multi-threaded runtime only after a measurement shows the default
  falls short.
- Stable Rust, pinned in `rust-toolchain.toml`. No nightly.
- HTTPS: `reqwest` + `rustls` + `ring` + `webpki-roots` everywhere.
- `scripts/ci`, the local merge gate, builds every crate for Linux and `aarch64-linux-android` from the
  first commit.
- Budgets in `scripts/ci`: ≤ 32 MB resident on Linux and Android with no growth over 72 h; binary ≤ 25 MB
  including the SPA. Re-set once after the first real build, then held.

## Consequences

- A dependency that does not build for Android fails the PR that adds it.
- Every machine running `scripts/ci` carries the Android NDK and `cargo-ndk`.
- The pure decode and rollup code is what a future microcontroller build would reuse; nothing is shaped
  for one now.
