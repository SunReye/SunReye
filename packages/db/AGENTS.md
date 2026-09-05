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

- Numbered files (`0000_bootstrap.sql`, `0001_*.sql`, …) are **structural** and
  journaled — applied exactly once, in order, non-transactionally. Keep every
  statement idempotent anyway (defense in depth: a mid-file failure re-runs the
  file).
- `policies.sql` is **re-applied on every migrate run** — put refresh /
  compression / retention tuning there so interval edits reach existing
  deployments.
- **Never DROP an existing continuous aggregate in a migration.** `metrics_raw`
  has 7-day retention, so a drop/recreate can only re-materialize the last 7
  days and silently destroys all long-horizon history. Additive changes create
  a *new* aggregate under a new name.
- Rollup views (`*_rollups`) stay excluded from drizzle via `tablesFilter` in
  `drizzle.config.ts` — do not remove that filter.
