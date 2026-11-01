# 6. One dependency set for every target

Status: accepted (2026-11-01)

## Context

The core targets Linux, Android (`aarch64-linux-android`) and ESP-IDF (`riscv32imafc-esp-espidf`, tier 3,
nightly `-Zbuild-std`). Per-target libraries multiply code paths and the bugs in them. The tokio stack
already spans all three: Axum 0.8, `std::fs` over ESP-IDF's VFS, plain TCP for Modbus and MQTT.

## Decision

Every crate in the workspace builds for all three targets. Code differs per target only in runtime
startup (eventfd registration, thread stacks, single-threaded tokio), network bring-up, and the Android
Kotlin/JNI shell.

- No trait or seam until a second implementation exists.
- Rules fixed from the start: bounded memory, single-threaded runtime, no `AtomicU64`, no process
  spawning.
- HTTPS: `reqwest` + `rustls` + `ring` + `webpki-roots` everywhere. If `ring` cannot build for ESP-IDF,
  every target moves to `rustls-rustcrypto`; targets do not split.
- `scripts/ci`, the local merge gate, builds every crate for all three targets from the first commit, with a
  nightly pinned before rust-lang/rust#164555.
- Budgets in `scripts/ci`: ESP32 ≤ 8 MB PSRAM and ≤ 256 KB SRAM steady with no heap growth over 72 h;
  Linux/Android ≤ 32 MB resident; binary ≤ 25 MB including the SPA. Re-set once after the first real
  build, then held.

## Consequences

- A dependency that does not build for ESP-IDF fails the PR that adds it.
- Every machine running `scripts/ci` carries an ESP-IDF toolchain (~1–2 GB) and a pinned nightly.
- `ring` on ESP-IDF needs `less-safe-getrandom-espidf`; on-device entropy is verified when ESP32 work
  starts.
