# 27. Inverter and battery types and the datasheet catalogue

Status: accepted (2026-11-19)

## Context

An MPPT input's limits come from the inverter's profile (ADRs 5, 17), and a string may name only an inverter the core knows by profile. A profile describes registers; a planner needs the datasheet of every inverter and battery on the market, most of which have no profile. A profile corrected later would also change a layout already checked against it.

## Decision

**Types.** An inverter type and a battery type hold datasheet values, as a module type does (ADR 17):

- inverter type: maker, model, maximum DC input voltage, AC rating, efficiency, and per MPPT input its voltage window, start voltage and maximum input current;
- battery type: maker, model, usable capacity, charge and discharge power, round-trip efficiency.

A device may carry one inverter type and one battery type, copied by value. The layout reads an inverter's limits from its inverter type when it has one, else from its profile, so every device added before this keeps working. A string may name any inverter device that has either.

**Datasheet catalogue.** Bundled with the core beside the module catalogue and under its rules (ADR 17): one sheet per maker's datasheet with its title, revision and URL; every value copied from it, a missing one left out and never estimated; a sheet without its source or with a value out of range or inconsistent is refused at build time by test. An entry names the profile that reads the same model, where one exists (ADR 5). Admins read it at `GET /api/v1/datasheet-catalogue`; picking an entry adds a type, so a layout never depends on the catalogue.

**Origin.** Every sheet, the module catalogue's included (ADR 17), names the country of its maker's registered seat as the datasheet prints it, and the country of manufacture only where the datasheet states one, never inferred from the brand. A type copies both. SunReye Plan filters on them when a customer asks for makers from a region (ADR 25); the core only stores them.

**Not yet monitorable.** An inverter type without a profile can be planned, wired and forecast. Its device stays pending (ADR 26) until a profile for it exists.

## Open before build

- The bounds each value is checked against.
- Whether hybrid inverters need a battery-side voltage window in the inverter type.

## Considered options

- **Limits from profiles only.** Rejected: a planner could offer only what Home already reads.
- **Layouts referencing catalogue entries.** Rejected as for modules: a catalogue fix would silently change past layouts.
- **The profile winning over the type.** Rejected: a plan checked against a datasheet would shift when a profile is corrected.
- **One catalogue for modules, inverters and batteries.** Rejected for now: the module catalogue's endpoint is published; the two share rules, not a file.

## Consequences

Plan adds entries faster than core releases ship, and its organisations keep private ones. Both arrive in Home by value inside a plant document, so Home needs no catalogue update to import a plan.
