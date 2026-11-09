# 18. Import from v3

Status: accepted (2026-11-08), amended (2026-11-09)

## Context

Homeowners run the v3 add-on (3.0.0 and later) with years of history in its bundled TimescaleDB. v4 was never public and is skipped. v3's Postgres listens only on `127.0.0.1` inside its own container, so another add-on cannot read it. v3 already ships `sunreye export`, which writes the `sunreye-archive` format, version 1: a `.tar.gz` holding the configuration graph and the history tiers `raw`, `minute`, `hourly` and `daily`. For each UTC day it takes only the finest available tier, so nothing is counted twice.

## Decision

- **No v3 release.** The user runs v3's existing `sunreye export` and imports the file into v5 by hand. v5 contains no Postgres client.
- **Starting it.** The admin starts the import from the settings in the SPA, either from a path under `/share` (the v5 add-on maps it read-only) or by uploading the file. `sunreye import <file>` serves Docker and bare-metal installs. The import runs in the storage task while the core keeps running; progress and result are shown, and the run is logged.
- **History.** Raw rows go through the same change-point encoder and deadbands as live readings. The hourly and daily tiers are imported as rollups only for spans with no raw rows left. The minute tier is ignored.
- **Raw holds.** A v3 raw row is a value held for `dur_ms`. The value counts as read to the hold's end, and a gap begins there when the next row starts more than 15 s later, v3's own gap threshold. A row without `dur_ms` holds to the next row within 15 s.
- **Buckets.** A v3 bucket is a value held for its whole UTC hour or day: a measurement's mean, so min and max equal it, and a counter's value, whose delta is its rise from an adjoining bucket before it. v3 cut days on UTC, so an imported day is keyed by its UTC date and records zone `UTC` (ADR 3). A UTC day with hours and no day of its own is summed from them; whole hours make that exact. A stored rollup is never overwritten.
- **Overlap.** For each series, rows are imported only before v5's own first change point, so data v5 recorded wins. Importing the same file twice changes nothing.
- **Mapping.** The admin maps each v3 device to a v5 device. v3 metrics map to v5 roles through the v3 profile, which converts units and signs to ADR 4's conventions once, at import. Configuration is not imported; first-run setup asks for it.
- **Conversion.** The v3 profile is the one the archive's `config.json` carries for the device. A v3 metric maps to the v5 device's quantity of the same key reading the same register; the value goes back to the raw register value through the v3 scale and offset and forward through the v5 ones, which carry ADR 4's signs. A computed quantity maps when its inputs share one scale and no offset and it sums or subtracts them, or when its inputs are unchanged. A metric with no such quantity is reported, not imported. The configuration log is not imported.
- **Tests.** A golden test imports an export of the owner's dev plant. It is built after the walking skeleton.

## Considered options

- **Reading v3's Postgres directly.** Rejected: unreachable across add-ons, a Postgres client in every binary for a one-time job, a port of v3's ~1,000-line exporter for both database shapes, and golden tests that need a TimescaleDB container outside the gate.
- **A final v3 release that exports to `/share` on its own.** Rejected: no breaking or extra v3 release.
- **Importing configuration.** Rejected: v3's single-inverter settings do not map onto v5's devices, connections and topology.

## Consequences

The archive format, version 1, is a contract v5 reads but never writes. A user who skips the export before removing v3 loses that history.
