# 13. Packaging and release

Status: accepted (2026-11-08), amended (2026-11-09)

## Context

v4 shipped images, an add-on, an appliance and an Android build, each with its own long tail. Hosted CI minutes are being saved until the project is stable.

## Decision

- **Layout.** `crates/` (Rust: `core`, `profile`, `pv` and one WASM glue crate per artifact), `apps/web` (SPA), `apps/cloud` (relay, TypeScript on Cloudflare, ADR 16, created when its build starts), `packages/` (npm: authoring API, CLI, WASM), `profiles/` (official profiles), `docs/adr/`.
- **First release.** A static Linux binary for amd64 and arm64 with a systemd unit, a multi-arch Docker image, and a Home Assistant add-on that wraps the image. The NixOS appliance and the Android app follow; no release gate depends on them.
- **Beside v3, not over it.** The core starts at version 5.0.0. The Home Assistant add-on is a new add-on with its own slug in the same add-on repository, installed next to v3's: updating v3's add-on in place would leave a database v5 cannot read and v3 unable to export. The user exports from v3, imports into v5 (ADR 18), compares, then removes v3. v3 gets no further release. The v5 add-on maps `share` read-only for the import.
- **Home Assistant add-on.** A skeleton test decides ingress: the SPA under a real ingress prefix. Pass: the add-on ships with ingress and a sidebar entry, and trusts HA's login (ADR 9). Fail: it exposes the core's own port with its own login. The core serves plain HTTP; TLS is a reverse-proxy job.
- **Core release.** Semver, cut by one local `bun run release` that builds the artifacts and the image, signs them with the release key (ADR 8), tags, and publishes. The changelog comes from conventional commits.
- **Profiles and npm.** Profiles publish separately (ADR 8). The npm package releases only when the schema, the capability table or a decoder changes.
- **Gate.** `bun run gate` (`scripts/gate.ts`) runs serially and stops at the first failure, cheapest first: formatting (`cargo fmt --check`, `oxfmt --check`, `prettier --check` on `.svelte`); lints (clippy, oxlint, fallow, `cargo deny`, `cargo shear`); types (`tsc`, `svelte-check`); builds and tests (`cargo test`, `pv` for `wasm32-unknown-unknown`, the WASM build and its tests, `bun test`, the SPA's component tests). The husky pre-commit hook runs all of it, never scoped to staged files or a merge base. Hosted CI returns when the project is stable and runs the same command.
- **Docs.** Plain Markdown under `docs/`, no docs site in the first release.

## Tooling

- **Clippy.** `-D warnings`; `pedantic` and `nursery` deny. Restriction lints: `unwrap_used`, `expect_used`, `panic`, `indexing_slicing`, `unwrap_in_result`, `panic_in_result_fn` (a panic is an outage beside grid hardware); `todo`, `unimplemented`, `dbg_macro`, `print_stdout`, `print_stderr`; `allow_attributes` and `allow_attributes_without_reason`, so every exception is `#[expect(lint, reason = "…")]` and fails once unneeded; `float_cmp`, `lossy_float_literal`, `let_underscore_must_use`, `wildcard_enum_match_arm`, `clone_on_ref_ptr`, `mem_forget`, `exit`, `tests_outside_test_module`. `clippy.toml`: cognitive complexity 10, nesting 4, 50 lines per function, 5 arguments; tests may unwrap, expect, panic and index.
- **Oxlint.** Plugins `typescript`, `unicorn`, `oxc`, `import`, `promise`. Categories `correctness`, `suspicious`, `perf` and `pedantic` are errors; `style` is off because oxfmt formats. Type-aware mode is on. anti-slop is vendored into `tools/oxlint/anti-slop` at a recorded commit, with its 18 generic rules as errors and its Effect group off.
- **Svelte files.** Checked 2026-11-09: oxfmt 0.77 does not format `.svelte`, so Prettier with `prettier-plugin-svelte` formats them. Oxlint 1.92 and anti-slop lint the `<script>` block but not template expressions; `svelte-check` type-checks those.
- **TypeScript.** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`.
- **Fallow.** Every rule an error. Cyclomatic 10, cognitive 10, CRAP 30 with the `bun test` coverage fed in (not yet possible: Bun writes only text and lcov, fallow 3.41 reads Istanbul or V8, so CRAP uses fallow's estimate from the module graph), duplicates at 40 tokens or 5 lines. Boundaries: `web` imports only its generated API client, `profiles` only the SDK, tooling anything. The whole repo is checked with zero findings and no baseline.
- **Rust dependencies.** `cargo deny`: advisories, licences compatible with AGPL-3.0, crates.io as the only source, duplicate versions as warnings, and bans that keep async runtime, network and database crates out of `profile` and `pv`. `cargo shear` finds unused dependencies.
- **Pins.** An exact stable Rust toolchain, Bun through `packageManager`, and exact versions of oxlint, `@oxlint/plugins` (anti-slop needs them equal) and oxfmt.

## Considered options

- **release-please and hosted publishing.** Rejected for now: it needs hosted CI.
- **All targets in the first release.** Rejected: each target needs its own verification.

## Consequences

A Home Assistant add-on repository is read by Supervisor from its default branch, so the add-on manifest must live there when the add-on ships.
