# SunReye Home

A local-first monitor for home solar, battery and meter hardware. It reads devices, stores their history, shows live and historic views, and writes a device's settings when the admin asks. One Rust process with an embedded web app and a SQLite file, built to run for years on low-power hardware.

This is version 5, a restart from specs: the branch `v5` shares no code with SunReye 3, which stays on `master`.

## What it does

- **Devices as data.** A profile describes a device model: its quantities, how to read them, which settings may be written. Inverters, batteries, meters, wallboxes through EVCC, heat pumps, gas and water meters.
- **History.** Every reading is stored and rolled up, fast across ten years.
- **Views.** A live dashboard, history, explore, forecast, and a 3D house with the plant on its roof.
- **Money.** Tariff, spot prices and savings.
- **Forecast.** Solar yield per string from the drawn roof and the weather.
- **Integrations.** An HTTP API with an OpenAPI document, MQTT, EVCC, Home Assistant.

Energy management, remote access through an encrypted relay and multi-plant views are designed for and come after the first release (`docs/adr/0001-scope-and-non-goals.md`).

## Status

No release is published yet. Build from a checkout; [docs/install.md](docs/install.md) has the binary, Docker image and Home Assistant add-on. Coming from SunReye 3: [docs/move-from-v3.md](docs/move-from-v3.md).

## Run from a checkout

Needs Bun and the Rust toolchain `rust-toolchain.toml` pins.

```sh
bun install
bun run --cwd apps/web build      # the core embeds this build
cargo run -p sunreye-core -- --data-dir "$HOME/.sunreye" --listen 127.0.0.1:8099
```

Open `http://127.0.0.1:8099` and set the admin password.

## Layout

- `crates/core`: the one process. Polling, storage, API, integrations; serves the web app.
- `crates/profile`, `crates/profile-wasm`: the profile format and its checks, natively and as WASM.
- `crates/pv`, `crates/pv-wasm`: the PV model. The browser and the core run the same code.
- `crates/synth`: generates ten years of a reference plant for the benchmark.
- `apps/web`: the SvelteKit app, built static.
- `packages/sdk`: `@sunreye/sdk` and the `sunreye-profile` CLI for profile authors.
- `profiles/`: the official profiles.
- `packaging/`: Dockerfile, systemd unit, Home Assistant add-on.

## Where things are decided

| To learn | Read |
| --- | --- |
| Why something is built the way it is | `docs/adr/`, one decision per file |
| What a term means | `GLOSSARY.md` |
| How the parts connect | `docs/architecture.md` |
| How to write a device profile | `docs/profiles.md` |
| How the PV model turns weather into watts | `docs/pv-model.md` |
| The rules for changing this repository | `AGENTS.md` |

## Contributing

`AGENTS.md` holds the rules, for people and agents alike: an ADR before the code it names, a failing test before the behaviour, conventional commits.

`bun run gate` is the only check. The pre-commit hook runs its fast steps; the whole gate runs before a merge.

A device profile is the easiest contribution: [docs/profiles.md](docs/profiles.md).

## SunReye Plan

[SunReye Plan](https://github.com/SunReye/plan) is the hosted planner for installers, a separate private product. It reads this repository's scene, PV and economics models, and hands a planned plant to Home as a plant document (`docs/adr/0025-sunreye-plan-and-shared-packages.md`).

## Licence

Source-available under the [PolyForm Shield License 1.0.0](LICENSE): use, change and share it for any purpose except to provide a product that competes with SunReye's. Device profiles and the profile SDK may also be used under AGPL-3.0-only. Details: [LICENSING.md](LICENSING.md).
