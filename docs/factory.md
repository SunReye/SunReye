# Agent factory

The factory takes labelled GitHub tickets through implementation, review and integration. One Claude Code session runs `/loop /factory`; deterministic scripts own slots, tracker state and merges. It opens and merges real PRs when running. Copying or configuring it does not start it.

SunReye's profile targets `v3` (the 3.0 rework branch). There is no hosted CI: the gate is `scripts/ci`, run in the slot; the train gate adds the browser suite. `factory merge` trusts that green run (`require_ci` is false). Root and area `AGENTS.md` instructions govern TDD, required test layers, hardware safety and review. The factory does not relax those requirements.

## Configuration

`scripts/factory/config.json` is the project adapter. Inspect it without credentials or runtime state:

```sh
scripts/factory/factory config
```

| Setting | Meaning |
| --- | --- |
| `repo`, `host` | GitHub repository and host; credentials come from `gh auth token` |
| `base` | Integration branch used for slot creation, diffs, trains and landing |
| `protected_branches` | Additional branches the hook blocks; `base` is always protected |
| `require_ci` | Refuse merging a PR whose current head has absent, pending or failed hosted checks |
| `commands.install` | Runs when a slot has no `node_modules` |
| `commands.prepare` | Runs on every slot checkout; empty for SunReye |
| `commands.regenerate` | Runs on request after merges; area guides cover migrations and other generated artifacts |
| `commands.gate` | Required local checks; must contain at least one command |
| `commands.train_gate` | Additional checks for the combined train, after the regular gate |
| `clean_paths` | Slot-relative disposable directories deleted on release; `target` for SunReye |
| `cargo_build_jobs` | `CARGO_BUILD_JOBS` in each slot; keep slots × jobs ≈ cores |
| `generated_paths` | Filename patterns excluded from PR size counting |
| `generated_conflict_paths` | Full repo-relative glob patterns whose conflicts may keep the train's side, pending regeneration |
| `ui_epic` | Optional parent ticket for `factory gap`; `null` disables that command before any tracker request |

Commands are arrays of argv arrays, run in order in the slot root, without a shell. Failure stops the sequence and produces a nonzero exit. Use a repository script for commands needing shell syntax. Keep credentials out of config. Install/prepare commands must support reuse. Cleanup rejects absolute paths, the slot root, parent paths and symlinks escaping the slot.

For example, another repository can configure its own `commands.prepare`, `clean_paths`, base and gate commands without changing the factory code. There is no built-in Worker app, CI-script path or staging branch requirement.

SunReye's local gate runs the full unit suite, mock hygiene, factory tests, Fallow, lint, formatting and types. The train also builds. Run them manually from the checkout being verified:

```sh
scripts/factory/factory regenerate
scripts/factory/factory gate
scripts/factory/factory gate --train
```

These commands do not authenticate to GitHub. They execute project commands and can modify generated files as those commands normally do. Neither gate replaces additional checks required by root or area instructions: component, browser, database, route, Nix and other checks apply to the areas changed. Database tests must use the guarded scratch harness; coordinate tests using shared ports or scratch databases across slots. Factory work must never use live inverter connections or a production database.

Migrations are deliberately absent from SunReye's automatic conflict patterns. Reconcile schema changes and regenerate through the database package's documented workflow.

## Pieces

| Piece | Location |
| --- | --- |
| Dispatcher | `.agents/skills/factory/SKILL.md`, linked from `.claude/skills/factory` |
| Control plane | `scripts/factory/factory`, `forge.py`, `slots.py` |
| Agents | `.claude/agents/factory-*.md` |
| Guard hook | `.claude/hooks/factory-guard.py` |
| Session settings | `.claude/factory/settings.json` |

Agents read the configured base and commands. Triage routes tickets to standard or deep implementation, or splitting. Implementers work test-first in fixed slots; reviewers check acceptance criteria and repo standards. The integrator gates the combined train and lands only a verified result. Report lines are checked by `scripts/factory/check-result-lines`.

## State and slots

Tracker labels (`factory:*`) and `.factory/state.json` in the main checkout are the durable state. Slots, logs and reviews live under `.factory/`, which is ignored by Git. Slot worktrees are reused with their own dependencies, not recreated for each ticket.

The frontier contains unassigned open `ready-for-agent` issues with a milestone, closed `Blocked by` dependencies, no active factory state and no open PR. It is ordered by milestone and issue number. Approved plus merging PRs above `max_waiting_prs` pause new claims; reviews and fixes continue.

Implementer shells are reniced using `slot_nice`; the merge slot keeps normal priority.

### Disk

| Control | Setting |
| --- | --- |
| Rust builds in a slot | `CARGO_INCREMENTAL=0`, `CARGO_PROFILE_{DEV,TEST}_DEBUG=line-tables-only`, `CARGO_BUILD_JOBS=cargo_build_jobs`, `CARGO_TARGET_DIR=<slot>/target` (never shared across slots) |
| Android and ESP-IDF toolchains | machine-wide under `~/.cache/sunreye-targets` (about 5 GB), installed once by `scripts/setup-targets`; `scripts/ci` fails naming it when they are missing |
| Checkout | `git clean` keeps `target/` and `node_modules` |
| After every agent | `factory release` deletes `clean_paths` (`target/`), and `node_modules` above `slot_node_modules_cap_gb` |
| Each tick | free disk below `disk_pause_free_gb` (30): `gc`, no new tickets · below `disk_critical_free_gb` (15): `gc --aggressive`, no build work |
| `gc` | cleans idle slots, removes slot dirs outside the configured pool, prunes worktrees, deletes merged `factory/*` branches, `docker image prune` |
| `scripts/ci` | heavy steps hold one of `CI_HEAVY_CAP` (2) machine-wide locks; database and route smoke share one exclusive lock |

Never deleted: your own checkouts and their `target/`. Budget about 15 GB free disk per extra implementer slot.

## Integration

1. `factory train` selects up to `max_train_prs` approved PRs, largest first, and merges them onto `factory/train` from the configured base in the merge slot. Ordinary conflicts drop a PR with an integration note; only configured generated conflicts keep the train's version for regeneration.
2. The integrator regenerates, commits any resulting changes, runs the configured train gate and all other required checks. On failure it can drop the responsible PR and rebuild. No passing gate means no landing, regardless of elapsed time.
3. `factory land` checks base-tree and PR-head freshness before each push. It pushes integrated PR branches normally and merges through the GitHub API with the exact head SHA. Hosted checks on the pushed head must be green when `require_ci` is true. Pending checks leave the PR in `factory:merging` for a later tick. The base tree must finally equal the verified train tree.

The base must not move during a train. A moved base or head causes landing to stop; remaining PRs need fresh integration. Dropped PRs return to changes; unreached approved PRs wait for the next train. Existing `.gitattributes` union rules combine append-only app notes; root and package guides retain normal conflict handling.

## Setup and run

First land this configuration and its scripts on the configured base so new slots contain them. Check local prerequisites: Bun, Python 3.10+, Git, GitHub CLI, Claude Code, the repo's dependencies, and tools needed by the task's required test layers.

After reviewing the profile, authenticate to the configured host and create labels:

```sh
gh auth status
scripts/factory/factory setup
```

Start a factory session from the main checkout:

```sh
claude --settings .claude/factory/settings.json --permission-mode dontAsk --model sonnet
```

Then invoke `/loop /factory`. This is an explicit start of unattended work. The guard reads the same config, blocks direct base/release pushes, requires explicit `factory/*` push destinations, rejects force pushes and skipped hooks, and requires merges through the control plane. A broken guard config blocks calls instead of silently disabling protection. The hook is a command guard, not an OS sandbox.

Inspect progress with `scripts/factory/factory status`. Esc stops new dispatch; already running agents may finish. `factory:human` marks questions or exhausted attempts; answer before clearing it. `scripts/factory/factory retry <pr>` grants another round to a parked PR.

## Validation

```sh
bun run test:factory
bun run test
```

Factory tests use temporary Git repositories and a GitHub stand-in: they exercise setup, reuse, cleanup, command failure, CI waiting, train tree equality, stale bases and heads, and the real hook's stdin/exit-code contract. They do not call GitHub or start app servers. `scripts/ci` runs the factory tests alongside the other repo checks. `check-result-lines` checks the agent/dispatcher reporting contract; it does not replace behavioral tests.
