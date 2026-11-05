---
name: factory
description: One tick of the agent software factory: read factory status, apply finished agents' results, dispatch implementers, reviewers and the integrator, merge green PRs, schedule the next tick. Use when running `/loop /factory`.
---

You are the factory **dispatcher**. Each tick is idempotent: the tracker and `scripts/factory/factory status` are the state; anything you remember from earlier ticks is not. Agents run in the background; their completion notifications wake you between ticks.

Setup, launch and tuning live in `docs/factory.md`. Read `scripts/factory/factory config` for the repository, base branch and commands; pass the configured base to every agent. Root and area `AGENTS.md` requirements govern tests, safety and review. This skill never relaxes them.

## Tick

1. **Status.** Run `scripts/factory/factory status`. Act only on this JSON.
2. **Apply results.** For every agent completion since the last tick, apply its result line (the line starting `RESULT`, `VERDICT`, `ROUTE` or `SPLIT`; table below). Done when no completion is unapplied.
3. **Disk.** `disk.level` `red`: run `scripts/factory/factory gc --aggressive` and dispatch no build work this tick (no claim, checkout or integrator). `amber`: run `scripts/factory/factory gc` and claim no new tickets.
4. **Merge.** For each PR in `prs.merging` (a train PR GitHub was slow to accept): `scripts/factory/factory merge <pr>`.
5. **Train.** If `free_slots.merge` and `prs.approved` are not empty and `prs.merging` is (a train built before that PR lands would stop on `stale-base`): run `scripts/factory/factory guard-golden <pr>` for each approved PR; where `ok` is false, write the touched paths to `.factory/reviews/<pr>-golden.md` and run `factory verdict <pr> changes`. Then `scripts/factory/factory train` (up to `max_train_prs` approved PRs, largest first; remaining PRs go in the next train) and spawn **factory-integrator** with that JSON.
6. **Review.** For each PR in `prs.review` with no `review:<pr>` entry in `runs`, up to `max_parallel_reviews` running: `scripts/factory/factory run start review <pr>`, then spawn reviewers. The agent definitions carry the scratch, budget and gate rules; the prompt is `pr`, `issue`, `branch` plus ticket-specific points only:
   - `deep` PR: **factory-reviewer-spec** (pass `model: opus`, `effort: medium`) and **factory-reviewer-standards** in one message.
   - `std` PR: one **factory-reviewer-spec** that also covers the standards axis (prompt it to read `AGENTS.md`, the area guides and the smell baseline, and to write both `<pr>-spec.md` and `<pr>-standards.md`); its reply opens with one `VERDICT` line.
   - Re-review fix rounds against the previous findings and changed behavior; test-only and documentation changes still need a verdict.
   - **Merge-only round.** Skip reviewers and run `scripts/factory/factory verdict <pr> approve` on the earlier review files when both hold; any other change gets a review. The implementer skips the per-PR gate here; the train gate verifies the combined tree. The approved head is the PR's last commit before its latest `Factory review: approve` comment (`gh pr view <pr> --json commits,comments`).
     - `git log --format=%s <approved-head>..origin/<branch>` lists one `chore: merge <base> into <branch>` subject and nothing else.
     - `git diff --name-only <approved-head> origin/<branch>` names only files in `git diff --name-only <approved-head>...origin/<base>`.
7. **Fix.** For each PR in `prs.changes` while `free_slots.impl` is not empty: `scripts/factory/factory checkout <pr> impl`, then spawn **factory-implementer** in fix mode with that JSON. Pass `model: opus` and `effort: medium` when the PR's `route` is `deep`.
8. **New work.** Only on a green disk and while `claim_blocked` is false (approved and merging PRs exceed `max_waiting_prs`: fix rounds, reviews and integrations still run, only new tickets wait), while `free_slots.impl` is not empty, take frontier tickets in order:
   - `route` null: spawn **factory-triage** in mode `route <issue>` in the foreground, then `scripts/factory/factory route <issue> <route>`.
   - `split`: `scripts/factory/factory run start split <issue>`; spawn **factory-splitter**.
   - **Overlap.** Before `claim`, compare the files the ticket names with `gh pr diff <pr> --name-only` of every open factory PR; on any overlap skip the ticket and take the next one.
   - `std` or `deep`: `scripts/factory/factory claim <issue>`; spawn **factory-implementer** with that JSON, passing `model: opus` and `effort: medium` for `deep`.
9. **Stale runs.** A `busy_slots` or `runs` entry older than 180 minutes with no live agent is dead: release its slot or end its run, then `scripts/factory/factory fail <issue> stalled`.
10. **Report** one line per action taken, then the counts (frontier size, PRs per lane, slots busy, disk free), then `Recommendation:` as the last line: one concrete next action for the person, or `none`.
11. **Wake.** `done` true and nothing dispatched: stop the loop and report the `human` list. Agents running: schedule a long fallback (1800 s); their completions wake you sooner. Only CI pending: 300 s. Otherwise 900 s.

- **Parents.** An open ticket titled `Epic:` or whose body lists child tickets, with every child closed, is closed with a one-line comment naming the children; never build it. Do this before claiming from the frontier.
- **Follow-ups.** For each PR that landed, collect the `Follow-up:` lines of `.factory/reviews/<pr>-*.md`; when any exist, file one ticket `Follow-ups from #<pr>` with one `- [ ]` per line, the PR's milestone and `ready-for-agent`.
- **Rate limit.** A stop whose summary names `rate_limit` (HTTP 429, "weekly limit") is not a failure: do not call `factory fail`, dispatch nothing new until the stated reset time, then resume each agent with `SendMessage` and a one-line brief.
- **Train isolation.** Merge into the configured base only between trains. A slow or failed gate remains unresolved: read its log and repair or drop the responsible PR. Landing requires every applicable gate to pass; elapsed time never substitutes for verification.


Spawn every agent in the background except triage, and pass the JSON the script printed verbatim in its prompt.

## Results

| Agent | Result line | Apply |
|---|---|---|
| implementer | `RESULT pr=<n>` | `factory opened <issue> <n>` (exit 1: oversized, ticket routed to split); `factory release <slot>` |
| implementer | `RESULT failed: split needed …` | `factory route <issue> split`; `factory release <slot>` |
| implementer | `RESULT failed: …` | `factory fail <issue> <reason>`; `factory release <slot>` |
| implementer | `RESULT human: …` | `factory human <issue> <question>`; `factory release <slot>` |
| reviewers (all done) | `VERDICT …` (one per reviewer) | `factory verdict <pr> approve` when every reviewer approves, else `changes`; `factory run end review <pr>` |
| integrator | `RESULT train changes=<prs>` | `factory verdict <pr> changes --uncounted` for each listed PR; `factory release <slot>` |
| integrator | `RESULT human: #<pr> …` | `factory human <pr> <question>`; `factory release <slot>` |
| triage | `ROUTE <route>: …` | `factory route <issue> <route>` |
| splitter | `SPLIT …` | `factory run end split <issue>` |

A result without its line counts as `RESULT failed: no result line`. All commands are `scripts/factory/factory …`.
