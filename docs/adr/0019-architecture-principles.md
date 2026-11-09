# 19. Architecture principles

Status: accepted (2026-11-08), amended (2026-11-09)

## Context

ADRs 1 to 18 already separate commands from queries and keep facts append-only, but no rule says so, and nothing says which module owns which data. Code written by agents drifts toward whatever touches the nearest table. The owner wants features consumed like libraries: nothing reaches into anything else.

## Decision

- **Commands and queries.** A state change is a command to the one module that owns that state; device writes go through the funnel (ADR 7). A query reads memory or stored data and never touches a device or another module's state.
- **Facts are appended.** Readings are change points (ADR 3), writes are the write log (ADR 7), forecasts keep their issue time (ADR 15). Every configuration change also appends to a change log: actor, what changed, when, and the date it applies from. Current-state tables remain what screens read. Derived data (rollups, `cost.*` series, plant aggregates, string estimates) can be rebuilt from facts while they are retained.
- **Feature modules own their data.** Each feature module of the core (storage, settings, topology, tariff, forecast, auth and the rest) owns its tables and is the only writer. Others reach it through its interface: commands in, queries out, and the events it publishes on the bus. No module issues SQL against another's tables. Storage's migrations create every module's tables in the one file, and a module's SQL runs on the storage thread's one connection (ADR 2), lent through storage's interface.
- **A pure core in every feature.** Decisions are pure functions over values: rollup arithmetic, tariff evaluation, recipe planning, topology balance, the PV model. The tasks around them do the I/O and stay thin. Tests cross the pure interface first.
- **Boundaries.** Inside `core`, each feature module exposes one `pub` interface and keeps the rest private, without `pub(crate)` reach-ins. A feature becomes its own crate only when it must be pure or reused elsewhere, as `profile` and `pv` are; the compiler and `cargo deny` then enforce it.

## Considered options

- **Event sourcing configuration.** Rejected: event versioning and replay for every screen cost more than they return for one household; the change log gives the audit trail and effective dates.
- **Event sourcing devices.** Rejected: the device holds its own state; a write's read-back is the fact recorded.
- **A crate per feature.** Rejected for now: slower builds and many small crates; module privacy and the ownership rule hold the line until a second consumer needs a crate.

## Consequences

Every ADR and review can cite one rule: who owns this state, and is it reached through the owner's interface. A feature that needs another's data asks for a query or listens for an event; it never joins the other's tables.
