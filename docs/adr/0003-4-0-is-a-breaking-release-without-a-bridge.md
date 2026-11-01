# 3. 4.0 is a breaking release without a bridge

Status: accepted (2026-11-01)

## Context

The Rust core (ADR 0002) replaces Postgres with one SQLite file (ADR 0004) and ships without control
(ADR 0005). Existing installs hold years of history in TimescaleDB, and some have automation writing
inverter registers. 3.x shutdown deliberately does not restore the user's register values, so an
install upgraded with automation on would stay on SunReye's last write.

3.x already exports an archive (`packages/db/src/archive.ts`): `manifest.json`, `config.json` (plant
graph and `app_settings`, including automation state and the user's saved values) and NDJSON readings
for the raw, minute, hourly and daily tiers. It carries no user accounts.

## Decision

4.0 is a breaking release with a manual migration and no bridge release:

1. Export the archive from 3.x.
2. Import it into 4.0. The core reads the existing archive format and never links a Postgres client.
3. If `config.json` shows automation enabled, the import stops, shows the saved user values, and
   continues only after the user confirms automation was switched off in 3.x (which restores them).

4.0 ships so no auto-update reaches a running 3.x: a new Home Assistant add-on ("SunReye 4") while the
3.x add-on gets a deprecation notice, a new Docker major tag with `latest` held back, and a separate
NixOS channel.

## Consequences

- No TypeScript work is needed for the migration; 3.x keeps running until the user switches it off,
  which is the rollback.
- 4.0 starts with a fresh admin; passwords use Argon2id with per-target parameters. 3.x scrypt hashes
  (N=16384, r=16, 32 MiB per check) are never imported.
- Imported: daily and hourly tiers in full, minute and raw up to the target's retention.
- 4.0 is beta (beta channel on every target) once: oracle fixture parity, route smoke and e2e journeys
  pass against the Rust binary; a production 3.x archive imports with manifest row counts matching; a
  72-hour read-only soak against a live plant stays within budget with no gaps; and the SPA has no dead
  controls.
