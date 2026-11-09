# Write a profile

A profile describes one device model: its quantities, how to read them, and which settings it may write. Homeowners never need this guide; profile authors do.

The format is defined in [ADR 5](adr/0005-device-profile-format.md), roles and their units and signs in [ADR 4](adr/0004-roles-and-conventions.md), distribution and trust in [ADR 8](adr/0008-profile-distribution-and-trust.md). Every field and its type is in `packages/sdk/src/generated.ts`; `profiles/*.ts` are worked examples.

## Setup

The SDK (`@sunreye/sdk`, with the `sunreye-profile` CLI) is not published to npm yet. Work in a checkout, with Bun and the Rust toolchain `rust-toolchain.toml` pins:

```sh
bun install
bun run --cwd packages/sdk wasm
```

The second command builds the profile WASM the CLI runs. Run the CLI as `bun packages/sdk/src/cli.ts <command>`.

## Write it

One TypeScript module per profile, its default export a `defineProfile` call, so the editor completes and checks every field. A Modbus meter, `my-profiles/acme-m1.ts`:

```ts
import { defineProfile } from "../packages/sdk/src/index.ts";

export default defineProfile({
  schema: 1,
  id: "acme-m1",
  name: "M1",
  manufacturer: "Acme",
  version: "1.0.0",
  requires: ["modbus", "i16", "u32"],
  quantities: [
    // Positive when importing, as grid.power requires; negate in the profile if the device differs.
    { key: "power", role: "grid.power", register: 0, type: "i16" },
    // Double words read low word first unless the profile says otherwise.
    { key: "imported", role: "grid.energy.imported.total", register: 2, type: "u32", scale: 0.01 },
  ],
});
```

- `requires` lists every capability the profile uses; lint warns about a missing one.
- A quantity reads one register, topic or HTTP JSON pointer, or `compute`s from quantities declared before it.
- Signs and units follow the role, converted in the profile, never by a consumer.
- A setting must be bounded by a `range` or `values`. Mark it `verified: true` only once its write was checked on real hardware; until then it stays off until an admin enables it.

## Check it

```sh
bun packages/sdk/src/cli.ts lint my-profiles/acme-m1.ts
bun packages/sdk/src/cli.ts decode my-profiles/acme-m1.ts dump.json
```

`lint` prints the warnings the core would log, or fails with the reason the core would refuse it. `decode` prints each quantity's value from a register dump, a JSON list of runs:

```json
[{ "start": 0, "words": [65436, 0, 1000, 1] }]
```

## Record a capture

A capture records a real device read-only, for replay in tests. It reads through a profile the core bundles, so a new profile needs a core built with it (see Official profiles). With the core binary built:

```sh
sunreye capture --endpoint modbus-tcp://192.168.1.50:502 --unit 1 --profile acme-m1 > acme-m1.ndjson
```

`--endpoint` takes `modbus-tcp://`, `rtu-over-tcp://` or `solarman-v5://host:port`; `--unit` is the device's unit id. `bun packages/sdk/src/cli.ts capture <endpoint> <unit> <profile>` runs the same through the core named by `SUNREYE_CORE`, else `sunreye` on the `PATH`.

## Share it as a community profile

Build a directory of profiles into `<id>.json` files and an `index.json`:

```sh
bun packages/sdk/src/cli.ts build my-profiles
```

A rebuild bumps a profile's patch version when its content changed; raise `version` in the source to cut a minor or major. Serve the directory over HTTP(S).

The admin adds the index once. There is no SPA screen for it yet; use the API with an admin token:

```sh
curl -X POST http://sunreye.local:8099/api/v1/profile-indexes \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"url": "https://example.org/my-profiles/index.json"}'
```

The core fetches it at once, and again only on `POST /api/v1/profile-indexes/check`. An unsigned profile is a community profile: it loads read-only, and each setting writes only once an admin enables it.

## Make it official

An official profile is signed by the profile key and backed by a capture of a real device.

1. Put the module at `profiles/<id>.ts`.
2. Render it and commit the source with its output; a test fails when the committed `profiles/<id>.json` and `profiles/index.json` are not the build of their source:

   ```sh
   bun run build:profiles
   ```

3. Add the rendered file to `BUNDLED` in `crates/core/src/profiles.rs`, so the core embeds it.
4. Add the capture as `crates/core/fixtures/capture/<id>.ndjson` with a replay test beside the existing ones in `crates/core/src/capture/tests.rs`.
5. Open a pull request. `bun run gate` must pass.

A maintainer publishes with `bun run publish:profiles`, which signs with the key named by `SUNREYE_PROFILE_KEY`. Pending the key ceremony, it refuses: no profile is signed and none is official yet.
