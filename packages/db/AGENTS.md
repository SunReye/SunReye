# packages/db

Schema, journaled migrations, and the TimescaleDB pipeline.

## Schema changes

- Prototyping: `bun run db:push`.
- Anything that ships is a committed migration: after changing `src/schema`, run
  `bun run db:generate` and commit the new `src/migrations/` file and the `meta/` journal. CI fails
  on schema/journal drift.
- Production applies schema only through `bun run db:migrate` (`src/migrate.ts`): downgrade guard →
  baseline stamping for pre-journal databases → pending drizzle migrations → TimescaleDB pipeline.
- Never edit a committed migration; add a new one.

## TimescaleDB pipeline (`src/timescale/`)

- Numbered files (`0000_baseline.sql`, `0001_*.sql`, …) are structural and journaled: applied once,
  in order, non-transactionally. Keep every statement idempotent anyway.
- A structural change is always a new file name. `timescale_migrations` records a file hash and never
  verifies it, so an edited applied file is silently ignored.
- `policies.sql` is re-applied on every migrate run: refresh, compression and retention tuning go there.
- Never DROP an existing continuous aggregate. A recreate re-materializes only as far back as
  `metrics_raw` reaches and silently destroys older buckets. Add a new aggregate under a new name;
  the tiers store `time_weight` / `counter_agg` partials, so a new accessor or hierarchical child
  usually needs no re-materialization. The one exception and why it is not precedent: header of
  `0000_baseline.sql`.
- Rollups need `timescaledb_toolkit`, which only the image `scripts/storage-tuning.ts` names ships.
- Prove pipeline behaviour (materialization, FKs, segmentby, compression) in
  `apps/server/db-tests/baseline.test.ts`, never by asserting on SQL text.
- Keep `*_rollups` views excluded from drizzle via `tablesFilter` in `drizzle.config.ts`.
