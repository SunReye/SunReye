# packages/db

Schema, journaled migrations, and the TimescaleDB pipeline.

## Schema changes

- Local prototyping: `bun run db:push` is fine.
- **Anything that ships must be a committed migration**: after changing
  `src/schema`, run `bun run db:generate` and commit the new file in
  `src/migrations/` + the `meta/` journal. CI fails when schema and journal
  drift.
- Production applies schema exclusively through `bun run db:migrate`
  (`src/migrate.ts`): downgrade guard → baseline stamping for pre-journal
  databases → pending drizzle migrations → TimescaleDB pipeline. The compose
  migrate image and the Home Assistant addon both run this runner.
- Never edit an already-committed migration file; add a new one.

## TimescaleDB pipeline (`src/timescale/`)

- Numbered files (`0000_baseline.sql`, `0001_*.sql`, …) are **structural** and
  journaled — applied exactly once, in order, non-transactionally. Keep every
  statement idempotent anyway (defense in depth: a mid-file failure re-runs the
  file).
- `policies.sql` is **re-applied on every migrate run** — put refresh /
  compression / retention tuning there so interval edits reach existing
  deployments.
- **Never DROP an existing continuous aggregate in a migration.** A
  drop/recreate can only re-materialize as far back as `metrics_raw` reaches, so
  it silently destroys every older bucket. Additive changes create a *new*
  aggregate under a new name.
  - The rule was suspended **once**, on 2026-08-27, to replace two generations of
    aggregates whose identity columns were being retired. The reasoning and the
    reasons it is not precedent are in the header of `0000_baseline.sql`. It is
    back in force, and cheaper to obey now: the tiers store `time_weight` /
    `counter_agg` PARTIALS, so a new accessor or a hierarchical child usually
    answers a new need with no re-materialization.
- **A structural change is always a NEW FILE NAME.** `timescale_migrations`
  records a file hash and never verifies it, so editing an already-applied file
  is silently ignored on every database that has run it.
- The rollups need `timescaledb_toolkit`, which only
  `ghcr.io/sunreye/timescaledb:pg17-ts2.28.2` ships. `scripts/storage-tuning.ts`
  gates every deployment surface on that one image; without it the baseline
  cannot be applied at all.
- Real behaviour of the pipeline (aggregates materializing, FKs, segmentby,
  compression) is proved in `apps/server/db-tests/baseline.test.ts`, never by
  asserting on SQL text.
- Rollup views (`*_rollups`) stay excluded from drizzle via `tablesFilter` in
  `drizzle.config.ts` — do not remove that filter.
