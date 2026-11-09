# 8. Profile distribution and trust

Status: accepted (2026-11-08), amended (2026-11-08, 2026-11-09)

## Context

A profile can declare writable settings, so a hosted profile is a supply-chain path to a grid-tied device. A profile fix must also reach users without a core release.

## Decision

**Index.** A static `index.json` lists each profile: id, semver, schema, required capabilities, SHA-256, URL and signature. The CLI builds validated rendered JSON and the index. Anyone can host an index; a custom profile is distributed through a custom index.

**Index format.** `{ "profiles": [...], "revocation"?: {...} }`; unknown fields are ignored. An entry is `id`, `version` (`major.minor.patch`), `schema`, `requires`, `sha256`, `url` and, when signed, `signature`. The hash and signature are lowercase hex; `url` is absolute or relative to the index's. A revocation is `key`, the revoked active key, and `signature`, the backup's signature over that key's 32 bytes. An index can list one id in several schemas.

**Publishing.** Official profiles live in `profiles/`, written in TypeScript and tested with the shipped WASM. `bun run publish:profiles` builds, validates, signs and pushes only the output to an orphan `profiles-dist` branch served by GitHub Pages. It creates no tag, no release and no npm publish. The build (`bun run build:profiles`) renders each `profiles/<id>.ts` to `profiles/<id>.json` and `profiles/index.json`, both committed: the core embeds the rendered file, and the last build is the baseline the next is compared with. A change to anything but `version` bumps the patch; the source's `version` is a floor an author raises to cut a minor or major. A test fails when the committed output is not the build of its source. The maintainer runs it locally; the private key stays outside the repo. A test verifies that a fresh bundle verifies against the compiled profile key. Hosted CI, when it returns, receives the key as a secret and runs the same command.

**In the core.** An admin adds an index URL once. The core fetches only on that action or on "check for updates", never on a timer. It verifies the hash before storing, validates with the same loader, stores the profile under the data directory and serves the last good copy. The official index's URL is built in, and the binary embeds a snapshot of the official profiles at release time so a first run works offline. A fetched profile replaces a bundled one only when its semver is higher and its signature verifies.

**Keys.** One signing key per purpose: profiles, web bundles (ADR 16) and release artifacts (ADR 13). Each has an active key and a backup kept offline. Signatures are Ed25519 over the exact file bytes, never over re-serialised JSON; the index's SHA-256 covers the same bytes. The core compiles in the profile key and its backup. A revocation of the active key, signed by the backup, is published in the index; the core then trusts only the backup, and remembers it. A fetched copy the active key signed then counts as community. The public keys are compiled in as `KEYS` in `crates/core/src/profiles/trust.rs`; until the owner's key ceremony sets them it is `None` and no fetched profile is official. The official index is `https://sunreye.github.io/SunReye/index.json`.

**Trust.** Official profiles are those whose signature verifies. A profile from any other index loads read-only; the admin enables a write per setting with its declared bounds shown. Until that enable exists, a community profile writes nothing (`setting.community`). The same per-setting enable applies to an official setting marked `verified: false` (ADR 5).

**Updates.** Applying an update is an admin click, shown as a diff. A change to a writable setting (added, a different register, bounds or unit) switches that setting's writes off until re-enabled. Official profiles follow the same rule: a fix never silently widens what the core may write.

**Compatibility.** An entry whose schema is above the core's range, or that requires a capability the core lacks, is listed as "needs a newer core" and not downloaded. Official profiles are published in the current schema and, while it is supported, the previous one.

## Considered options

- **Hash only.** Rejected for anything that can write.
- **Timed auto-update.** Rejected: it changes the write set unattended.
- **Profiles inside core releases.** Rejected: profile updates must not trigger one.
- **The separate official-profiles repository.** Retired: a format change and the profiles that need it could not land in one commit. Its 20 Deye profiles are carried in as official, with a setting `verified` only where it was checked on the owner's inverter.

## Consequences

Switching to the backup key needs no core release; issuing a new backup does. Losing both keys of one purpose needs a core release, and until then a stolen key stays trusted.
