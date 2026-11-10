# 13. Packaging and release

Status: accepted (2026-11-08), amended (2026-11-10)

## Context

v4 shipped images, an add-on, an appliance and an Android build, each with its own long tail. Hosted CI minutes are being saved until the project is stable.

## Decision

- **Layout.** `crates/` (Rust: `core`, `profile`, `pv` and one WASM glue crate per artifact), `apps/web` (SPA), `apps/cloud` (relay, TypeScript on Cloudflare, ADR 16, created when its build starts), `packages/` (npm: authoring API, CLI, WASM), `profiles/` (official profiles), `packaging/` (the Dockerfile, the add-on manifest and the systemd unit), `docs/adr/`.
- **First release.** A static Linux binary for amd64 and arm64 with a systemd unit, a multi-arch Docker image, and a Home Assistant add-on that wraps the image. The NixOS appliance and the Android app follow; no release gate depends on them.
- **Beside v3, not over it.** The core starts at version 5.0.0. The Home Assistant add-on is a new add-on with its own slug in the same add-on repository, installed next to v3's: updating v3's add-on in place would leave a database v5 cannot read and v3 unable to export. The user exports from v3, imports into v5 (ADR 18), compares, then removes v3. v3 gets no further release. The v5 add-on maps `share` read-only for the import.
- **Home Assistant add-on.** A skeleton test decides ingress: the SPA under a real ingress prefix. Pass: the add-on ships with ingress and a sidebar entry, and trusts HA's login (ADR 9). Fail: it exposes the core's own port with its own login. The core serves plain HTTP; TLS is a reverse-proxy job. The add-on's slug is `sunreye_v5`.
- **Images.** One Dockerfile (`packaging/Dockerfile`) builds the static binary on Alpine and copies it into an empty image. Every architecture compiles on the build host and none is emulated: arm64 builds its bundled C with clang and lld against Alpine's aarch64 musl headers, so a host without QEMU builds both. Target `binary` exports the bare binary; the systemd unit (`packaging/sunreye.service`) runs it with a dynamic user and `/var/lib/sunreye` as its data directory. Target `core` sets `SUNREYE_DATA_DIR=/data`; target `addon` adds `SUNREYE_INGRESS=172.30.32.2` (ADR 2, 9). `bun run image:smoke` builds both and checks them behind an ingress stand-in.
- **Core release.** Semver, cut by one local `bun run release` that builds the artifacts and the image, signs them with the release key (ADR 8), tags, and publishes. The changelog comes from conventional commits. The workspace version in `Cargo.toml`, repeated in `packaging/addon/config.yaml`, names the release; a person bumps it in a commit, and the release refuses a dirty checkout or a version the commits since the last `v*` tag do not allow: a breaking change (`!` or `BREAKING CHANGE:`) needs the next major, a `feat` the next minor, a `fix` or `perf` the next patch, and with none of them nothing releases. A higher version stands. The changelog lists the breaking changes, features, fixes and performance commits since that tag, merges skipped.
- **Release artifacts.** `bun run release` (`scripts/release.ts`) builds with a Buildx builder of its own, removed with its cache afterwards: `sunreye-<version>-linux-amd64` and `-arm64`, each checked static, stripped and built for its architecture from its ELF headers; `sunreye.service`; `CHANGELOG.md`; the image `ghcr.io/sunreye/sunreye-v5:<version>` and `:latest` for both architectures; and the add-on's `ghcr.io/sunreye/sunreye-v5-addon-{amd64,aarch64}:<version>`. `images.txt` names each pushed image by digest. `SHA256SUMS` covers every file, and `SHA256SUMS.sig` is its raw Ed25519 signature, so a user verifies with `openssl pkeyutl -verify -pubin -inkey release.pub -rawin -in SHA256SUMS -sigfile SHA256SUMS.sig` and `sha256sum -c SHA256SUMS`.
- **Release order.** Plan, build and check everything, run `bun run image:smoke`, then refuse while `packaging/release.pub` is absent or `SUNREYE_RELEASE_KEY` names a private key it does not verify; nothing is pushed before that. Then push the images, sign, push the `v<version>` tag, create the GitHub release, and last commit the add-on's `config.yaml` and `CHANGELOG.md` to `sunreye_v5/` on the add-on repository's default branch, so Supervisor never offers a version whose image is missing. `bun run release:rehearse` runs the whole release on a clone of HEAD against stand-ins (a key made for the run, a local registry, bare repositories, a directory for the GitHub release) and checks the result as a user would; the real run waits for the key ceremony.
- **Profiles and npm.** Profiles publish separately (ADR 8). The npm package releases only when the schema, the capability table or a decoder changes.
- **Gate.** `bun run gate` (`scripts/gate.ts`) runs serially and stops at the first failure, cheapest first, after the SPA build the core embeds (ADR 11): formatting (`cargo fmt --check`, `oxfmt --check`, `prettier --check` on `.svelte`); lints (clippy, oxlint, fallow, `cargo deny`, `cargo shear`); types (`tsc`, `svelte-check`); builds and tests (`cargo test`, `pv` for `wasm32-unknown-unknown`, the WASM build and its tests, `bun test`, the SPA's component tests). The husky pre-commit hook runs all of it, never scoped to staged files or a merge base. Hosted CI returns when the project is stable and runs the same command. The image smoke is not in the gate: it builds both images and needs Docker, so each commit would wait minutes for it; the release runs it instead, so it cannot rot unnoticed past a release.
- **Docs.** Plain Markdown under `docs/`, no docs site in the first release.

## Tooling

- **Clippy.** `-D warnings`; `pedantic` and `nursery` deny. Restriction lints: `unwrap_used`, `expect_used`, `panic`, `indexing_slicing`, `unwrap_in_result`, `panic_in_result_fn` (a panic is an outage beside grid hardware); `todo`, `unimplemented`, `dbg_macro`, `print_stdout`, `print_stderr`; `allow_attributes` and `allow_attributes_without_reason`, so every exception is `#[expect(lint, reason = "…")]` and fails once unneeded; `float_cmp`, `lossy_float_literal`, `let_underscore_must_use`, `wildcard_enum_match_arm`, `clone_on_ref_ptr`, `mem_forget`, `exit`, `tests_outside_test_module`. `clippy.toml`: cognitive complexity 10, nesting 4, 50 lines per function, 5 arguments; tests may unwrap, expect, panic and index.
- **Oxlint.** Plugins `typescript`, `unicorn`, `oxc`, `import`, `promise`. Categories `correctness`, `suspicious`, `perf` and `pedantic` are errors; `style` is off because oxfmt formats. Type-aware mode is on. anti-slop is vendored into `tools/oxlint/anti-slop` at a recorded commit, with its 18 generic rules as errors and its Effect group off.
- **Svelte files.** Checked 2026-11-09: oxfmt 0.77 does not format `.svelte`, so Prettier with `prettier-plugin-svelte` formats them. Oxlint 1.92 and anti-slop lint the `<script>` block but not template expressions; `svelte-check` type-checks those.
- **TypeScript.** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`.
- **Fallow.** Every rule an error. Cyclomatic 10, cognitive 10, CRAP 30 with the `bun test` coverage fed in (not yet possible: Bun writes only text and lcov, fallow 3.41 reads Istanbul or V8, so CRAP uses fallow's estimate from the module graph), duplicates at 40 tokens or 5 lines. Boundaries: `web` imports only its generated API client, `profiles` only the SDK, tooling anything. The whole repo is checked with zero findings and no baseline.
- **Rust dependencies.** `cargo deny`: advisories, licences compatible with AGPL-3.0, crates.io as the only source, duplicate versions as warnings, and bans that keep async runtime, network and database crates out of `profile` and `pv`. `cargo shear` finds unused dependencies.
- **Pins.** An exact stable Rust toolchain, Bun through `packageManager`, and exact versions of oxlint, `@oxlint/plugins` (anti-slop needs them equal) and oxfmt.

## Ingress result

Passed locally on 2026-11-09, so the add-on ships with ingress (`packaging/addon/config.yaml`). `bun run image:smoke` ran both images on amd64 behind nginx standing in for Supervisor: it strips `/api/hassio_ingress/<token>`, sets `X-Ingress-Path`, binds its source to a stand-in Supervisor address and does not buffer. Verified there:

- Chromium loads the SPA at the prefix with every asset answered, and its live SSE stream answers 200 through the prefix with no refusal shown.
- The add-on image acts as admin for the stand-in address with the header, before any setup; the same header from another address gets `401`. The core image trusts no one and its screen asks for the admin password.
- The SPA opens on first-run setup until the admin has a device (ADR 11), and only the dashboard streams live values, so the smoke adds a device through the prefix first: an endpoint that answers nothing, writes off. A problem the core answers, as `layout.none` before any scene, counts as reaching it through the prefix.
- The add-on image carries `SUNREYE_INGRESS=172.30.32.2`.

Pending a check by the owner on a real Supervisor, which nothing here can reproduce:

- Supervisor's own proxy (aiohttp) in place of nginx: SSE unbuffered with `ingress_stream: true`, and response compression or headers it adds or drops.
- Requests really arrive from `172.30.32.2`, and a host port mapped for direct access does not arrive from it.
- HA's frontend iframe, its `ingress_session` cookie, and the sidebar panel.
- The `aarch64` image and binary running: the release rehearsal builds and pushes them (static, stripped, AArch64), but no arm64 host or emulator ran them.

## Considered options

- **cosign image signatures.** Rejected for now: the signed `images.txt` pins every image by digest without another tool or a transparency log.
- **QEMU for arm64.** Rejected: unprivileged hosts cannot register binfmt handlers, and emulated LTO builds are slow; cross-compiling works everywhere.
- **release-please and hosted publishing.** Rejected for now: it needs hosted CI.
- **All targets in the first release.** Rejected: each target needs its own verification.

## Consequences

A Home Assistant add-on repository is read by Supervisor from its default branch, so the add-on manifest must live there when the add-on ships.
