# Contributing to SunReye

Contributions are welcome — a new [inverter profile](https://sunreye.github.io/SunReye/profiles/authoring/), a feature, a fix, or a docs correction.

This file is the practical guide: how to get the stack running, what to run before you open a
PR, how a change travels from a branch to a released Home Assistant addon, and the repo
conventions that are easy to violate by accident.

- Area-specific rules live in the `AGENTS.md` file nearest the code you are touching. Those
  are authoritative where they overlap with this file.
- Reference documentation (architecture, settings, profiles, env vars) lives on the docs site
  under `apps/docs`.

---

## 1. Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| [bun](https://bun.sh/) | `1.3.13` (see `packageManager` in `package.json`) | Runtime **and** package manager. Do not use npm/pnpm/yarn — the lockfile is `bun.lock`. |
| Docker | any recent | Runs TimescaleDB for local development (`docker-compose.db.yml`). |
| git | any recent | — |

No inverter is required. The engine ships a simulator (`INVERTER_SIMULATE=true`), which is
how most development happens.

## 2. Get set up

```bash
git clone https://github.com/SunReye/SunReye.git
cd SunReye
bun install

cp apps/server/.env.example apps/server/.env   # then fill in what you need

bun run db:start      # TimescaleDB in Docker (holds port 5432)
bun run db:migrate    # schema + TimescaleDB policies
bun run dev           # every dev server: engine, dashboard, docs
```

Single app: `bun run dev:server` or `bun run dev:web`. Manage the database container with
`bun run db:watch` (tail logs), `db:stop`, `db:down`.

Every workspace command is listed in the [Scripts reference](apps/docs/src/content/docs/reference/scripts.md).

## 3. Where things live

| Area | Path |
| --- | --- |
| Core engine (poll loop, REST API, MQTT bridge) | `apps/server` |
| Dashboard (SvelteKit) | `apps/web` |
| Documentation site (Astro Starlight) | `apps/docs` |
| Modbus engine, registry, entity + role model | `packages/inverter-core` |
| Profile SDK + CLI | `packages/profile-sdk` |
| Schema, migrations, TimescaleDB, runtime settings | `packages/db` |
| Env schema, auth, shared config | `packages/env`, `packages/auth`, `packages/config` |
| Home Assistant addon (stable) | `sunreye/` |
| Home Assistant addon (beta channel) | `sunreye-beta/` |

See the [architecture deep-dive](apps/docs/src/content/docs/reference/internals.md) for how
they fit together.

## 4. Branch model

```
feature branch ──PR──▶ dev ──(auto)──▶ beta addon build ──▶ test on real hardware
                        │
                        └──PR (merge commit)──▶ master ──▶ release-please ──▶ stable release
                                                   │
hotfix ────────────────PR───────────────────────▶ ─┘
                                                   │
                                                   └──(auto) sync-dev merges master back into dev
```

- **`dev`** is the integration branch. Features land here first.
- **`master`** is the release branch and the repository default. The Supervisor can only read
  addon manifests from the default branch, which is why both `sunreye/config.yaml` and
  `sunreye-beta/config.yaml` live on `master`.
- **Hotfixes** may PR straight into `master`; the backmerge below carries them to `dev`.

Branch naming follows the commit types: `feat/…`, `fix/…`, `refactor/…`, `docs/…`, `ci/…`,
`chore/…`.

## 5. Day-to-day workflow

1. Branch off `dev`:
   ```bash
   git fetch origin
   git checkout -b feat/my-thing origin/dev
   ```
2. Make one logical change. Follow the conventions in [§8](#8-conventions-that-bite).
3. Run the checks for what you touched ([§7](#7-checks-before-you-push)).
4. Commit using [conventional commits](#commit-style). The pre-commit hook runs `oxlint`,
   `oxfmt --write`, the Fallow code-health gate, and the i18n lint on staged files, then the
   **whole test suite** — a red suite blocks the commit. It warns (never blocks) when code
   changed but no documentation did, and when staged source carries no staged test.
5. Open a PR into `dev`.

### Commit style

`type(scope): summary`

- Imperative, specific subject. Lowercase types: `feat`, `fix`, `refactor`, `docs`, `test`,
  `chore`, `ci`, `perf`.
- Scope when useful: `feat(web): add onboarding empty state`.
- One commit = one logical change. Do not mix refactor + feature + formatting noise.
- Explain *why* in the body when it is not obvious from the diff.

These messages are not cosmetic: release-please derives versions and the CHANGELOG from them
(see [§10](#10-cutting-a-release)).

## 6. Test-driven development is the rule here

SunReye reads and **writes** registers on grid-tied inverters and batteries. A wrong branch
does not render a wrong number on a page — it can hold a battery at the wrong SOC, export
against a feed-in limit, or dispatch on yesterday's tariff, on someone's house, unattended.
So behaviour lands with the test that proves it, and it lands in that order:

1. **Write the failing test first.** It names the behaviour you are about to add, in the terms
   the domain uses ("a month can never report less energy than the day inside it"), not the
   implementation you have in mind.
2. **Watch it fail.** A test that has never been red has proven nothing. If it passes before
   you write the code, it is testing something else.
3. **Write the smallest code that makes it green**, then clean up with the suite behind you.

What is enforced mechanically:

| Gate                                  | Where                            | Blocks                       |
| ------------------------------------- | -------------------------------- | ---------------------------- |
| Suite is green                        | `.husky/pre-commit`, CI          | commit, PR                   |
| Source changed ⇒ a test changed       | CI job **Tests required**        | PR (advisory on commit)      |
| Coverage may not fall                 | `scripts/coverage-floor.ts`, CI  | PR                           |

The coverage floor is a **ratchet**: it only turns up. If a change drops coverage, cover the
behaviour — do not lower `FLOOR`. If a file genuinely cannot hold a branch (a barrel, a type
module, a route shell), exempt it explicitly in `scripts/require-tests.ts`, with a test for
the exemption; there is no skip flag by design.

**One rule about mocks, because it has already cost a day.** bun runs every test file in one
process and `mock.module` is global and permanent, so the mock one file registers is live for
every file after it. That has two consequences, and a mock of one of our own modules has to
answer both.

*Spread, so the mock deletes nothing.* A factory that returns only the exports its own suite
needs *deletes* the rest for everyone downstream — the next file whose import chain needs a
deleted export dies at load, and since it never finishes loading, its own mocks never register
either. Unrelated suites then fail with errors naming none of the guilty code, and only in the
file order that particular machine happened to walk. Always spread the real module:

```ts
const real = await import("./config");
mock.module("./config", () => ({ ...real, getMqttConfig: stub }));
```

*Restore, so the stub does not outlive the suite.* The spread saves the other exports; the
stubbed one is still installed for every file that loads afterwards. When a later suite is the
one that **unit-tests that very module**, it silently imports the stub instead of the real
implementation and asserts against a double — red in the full run, green on its own. That is
exactly how `packages/db/src/spot-price.test.ts` went 22-tests-red ("no query was issued")
against the stub left behind by `apps/server/src/prices/spot-price-job.test.ts`. Hand the
module back in `afterAll`, snapshotting the real exports **by value at load time**:

```ts
const realDb = await import("@SunReye/db/spot-price");
const realDbExports = { ...realDb }; // by value, before any mock is installed

mock.module("@SunReye/db/spot-price", () => ({ ...realDb, getSpotPrices: stub }));

afterAll(() => {
  mock.module("@SunReye/db/spot-price", () => ({ ...realDbExports }));
});
```

The snapshot is the whole trick: a module namespace is **live**, so once the mock is installed
`realDb.getSpotPrices` *is* the stub — restoring with `() => realDb` restores the stub and does
nothing. `afterAll`, not `afterEach`: the rest of this file's own tests still need the stub.

`bun run test:mocks` enforces both (pre-commit and CI), matching the restore by specifier.
Third-party modules are exempt from both — stubbing `mqtt` wholesale is the point, and nothing
in this repo unit-tests it. The one escape hatch is
`// mock-hygiene-ignore-next-line -- <reason>`, for a module that cannot be imported for real
(`@SunReye/auth` boots Better Auth, which wants env and a database); the reason is mandatory.

Depth, not ceremony. A test that only re-states the happy path is close to worthless on this
system. Cover the boundaries that actually bite: zero and negative values (0 °C is a
temperature, −7.5 is a temperature, `0` is not "missing"), the empty and absent payload, the
stale reading carried across midnight, the window that starts mid-day, the register that
leads the rollups, the restart that leaves a hole in a counter. Prefer pure functions that
can be tested directly over logic buried in a component — extracting the guard so it can be
proven *is* part of the work, and both bugs the gates were built from were exactly that.

## 7. Checks before you push

Run what is relevant to the area you changed — this is what CI runs:

```bash
bun run check          # oxlint + oxfmt --write
bun run check-types    # tsc across the monorepo
bun run test           # bun test, all workspaces
bun run test:coverage && bun run test:floor              # the coverage ratchet CI enforces
bun run test:required  # source changed ⇒ a test changed (diffs against origin/dev)
bunx fallow            # code-health gate (dead code, duplication, complexity)
bun run build          # only when you touched build config or shared packages
```

Web work additionally:

```bash
cd apps/web
bun run check          # compile i18n, svelte-kit sync, svelte-check
bun run i18n:lint      # every locale must match en.json key-for-key
```

Schema work additionally:

```bash
bun run db:generate    # commit the generated migration — CI has a migration drift gate
```

CI runs four required jobs on every PR: **Tests required** (source changed ⇒ a test changed),
**Lint, type-check & build** (Fallow gate, oxlint, oxfmt `--check`, `check-types`, i18n lint,
migration drift gate, build), **Test & coverage** (the suite plus the coverage floor), and —
when the change touches `packages/db`, `apps/server`, `docker/`, or `sunreye/` — the
**Upgrade test**, which boots the last published release, collects data, swaps in the freshly
built images, and asserts the migration runner preserves the data and the server comes back
healthy.

## 8. Conventions that bite

- **Env vars are declared and validated only in `packages/env`** (`server.ts` / `web.ts`).
  Never parse `process.env` or add a per-package env schema. See
  `packages/env/AGENTS.md`.
- **Runtime configuration is not env.** The inverter connection, MQTT, tariff, and profile
  sources live in the `app_settings` table with per-key Zod schemas in `packages/db`.
- **Anything schema-shaped that ships must be a committed migration.** `db:push` +
  `db:timescale` are development conveniences; run `bun run db:generate` and commit the file.
  Never drop a continuous aggregate in a migration.
- **Inverter support is data, not code.** Prefer adding a
  [profile](apps/docs/src/content/docs/profiles/concept.md) over touching the engine. New
  canonical concepts go through the role catalog in `packages/inverter-core/src/roles.ts`.
- **The dashboard uses SvelteKit's hash router** so one build works behind Home Assistant
  ingress. All internal navigation must go through `resolve()` from `$app/paths` — a raw
  `goto('/login')` or `href="/login"` escapes the ingress prefix and 404s. No
  `+page.server.ts`, no SSR.
- **UI is composed from the existing shadcn-svelte components** in
  `apps/web/src/lib/components/ui/`. Check for an existing component before writing custom
  markup; see `apps/web/AGENTS.md` and `apps/web/DESIGN.md`.
- **User-facing strings are i18n messages.** Add the key to `apps/web/messages/en.json` *and*
  every other locale (`de`, `es`, `fr`, `it`) — `i18n:lint` fails on a gap, in CI and in the
  pre-commit hook.
- **Code health is gated.** `bunx fallow` covers dead code, duplication, and complexity. The
  pre-commit hook audits the staged state; CI (`bunx fallow --quiet`) gates the whole tree, so
  a finding you inherited from `master` can block your commit — check whether it is yours
  before "fixing" it.
- **`sunreye-beta/` is generated.** `scripts/sync-beta-addon.mjs` derives it from `sunreye/`.
  Never hand-edit it — change `sunreye/` and let the sync run.
- **`sunreye/config.yaml`'s `version` is machine-owned.** Neither you nor release-please
  edits it; `docker-addon.yml` bumps it after the images exist ([§10](#10-cutting-a-release)).

## 9. Testing on real hardware: the beta channel

Every push to `dev` builds a beta addon image automatically
(`.github/workflows/docker-addon-beta.yml`):

- Version scheme `beta.<YYYYMMDD>-<short sha>` — a beta cannot know whether the release it
  leads to will be major, minor, or patch, so it is not semver.
- The build bumps `sunreye-beta/config.yaml` on `master`, which is what the Supervisor reads,
  so the update appears in the **SunReye (beta)** store entry within a minute or two.
- One amd64 image per push; a nightly scheduled run build-checks aarch64 so ARM-only breakage
  surfaces before a release rather than during one.

To try a single branch on hardware without merging to `dev`:

```bash
gh workflow run docker-addon-beta.yml --ref my-branch
```

The beta store entry then serves that branch's image until the next `dev` push takes the slot
back.

The beta installs alongside the stable addon with its own `/data` and its own embedded
postgres, so it cannot touch production data, and its Changelog tab lists the unreleased
commits it contains. It ships `boot: manual` deliberately:

> **One inverter, one connection.** Most inverters accept a single Modbus TCP connection at a
> time. Stop the stable addon (or run the beta with `inverter_simulate`) before starting the
> beta against the same inverter.

The [README](README.md#beta-addon-channel) covers the channel's design in more depth (tag
pruning, changelog generation, why the manifest lives on `master`).

## 10. Cutting a release

1. **PR `dev` → `master`, and merge it as a merge commit.** Never squash *this* PR: squashing
   collapses a whole release into one subject line, and release-please builds the changelog
   from the individual conventional commits. Nothing enforces it — GitHub cannot set a merge
   strategy per base branch, and squash stays enabled for feature PRs into `dev`, where it is
   fine.
2. **release-please** (`.github/workflows/release-please.yml`) runs on the push to `master`
   and opens or updates a release PR with version bumps and CHANGELOG entries per component
   (server, web, profile-sdk, addon). Nothing ships while that PR is open.
3. **Merge the release PR.** release-please tags the release (`server-v*`, `addon-v*`, …) and
   dispatches the Docker builds itself — tags created with `GITHUB_TOKEN` do not trigger
   `on: push: tags` workflows.
4. **`docker-addon.yml`** builds the addon image for amd64 and aarch64. Only after *every*
   arch image is pushed does it bump `version` in `sunreye/config.yaml` and rewrite
   `sunreye/CHANGELOG.md` on `master`. That ordering matters: `version` must only ever name an
   image tag that already exists, or the Supervisor offers an update it cannot pull.
5. The Supervisor then offers the update to stable users.

`sunreye/config.yaml`'s `version` is therefore **not** hand-edited and **not** touched by
release-please.

## 11. The one manual gate: master → dev backmerge

`sync-dev.yml` merges `master` back into `dev` on every push to `master`, and **fails loudly
on conflict** rather than guessing at a resolution.

This matters more than it looks: the beta workflow and its scripts run from the checkout of
the branch that was pushed, so until `dev` contains `master`, every beta build silently ships
stale logic while looking perfectly healthy.

When the workflow reports a conflict:

```bash
git checkout dev
git pull
git merge origin/master      # resolve, keeping both sides where they merely collide
bun run check-types && bun run test
git commit
git push origin dev
```

Pushing `dev` triggers a fresh beta build, which closes the loop.

## 12. Editing the docs

The docs site is Astro Starlight under `apps/docs`. Pages are Markdown/MDX in
`src/content/docs`; the sidebar is configured in `astro.config.mjs`. Run it with
`cd apps/docs && bun dev`.

If a change alters documented behaviour, update the docs in the same PR. The pre-commit hook
prints a reminder when code changed and no documentation did; it is a reminder, not a gate,
and reviewers do treat missing docs as review feedback.

## 13. Reporting bugs

Open an issue with: SunReye version (and whether it is a stable or beta addon build), how it
is deployed (HA addon / Docker Compose / bun), the inverter profile in use, and the relevant
log lines. Addon logs come from the addon page in Home Assistant; include the boot lines —
the profile and the Modbus read plan are logged there and answer most questions immediately.
