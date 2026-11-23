# 27. Inverter and battery types and the datasheet catalogue

Status: accepted (2026-11-19), amended (2026-11-22, 2026-11-23)

## Context

An MPPT input's limits come from the inverter's profile (ADRs 5, 17), and a string may name only an inverter the core knows by profile. A profile describes registers; a planner needs the datasheet of every inverter and battery on the market, most of which have no profile. A profile corrected later would also change a layout already checked against it.

## Decision

**Types.** An inverter type and a battery type hold datasheet values, as a module type does (ADR 17):

- inverter type: maker, model, maximum DC input voltage, AC rating, efficiency, and per MPPT input its voltage window, start voltage and maximum input current;
- battery type: maker, model, usable capacity, charge and discharge power, round-trip efficiency.

A device may carry one inverter type and one battery type, copied by value. The layout reads an inverter's limits from its inverter type when it has one, else from its profile, so every device added before this keeps working. A string may name any inverter device that has either.

- *In the layout (2026-11-22).* Each layout version carries its devices' types beside its strings and scene, as `inverterTypes` and `batteryTypes` keyed by device id, so a type changed from a date leaves earlier estimates as they were (ADR 17). A layout change without them removes them; the builder sends back those of the version it opened. A version without types reads and saves as before, its members left out.
- *Read whole.* An inverter's limits (its maximum DC input voltage, AC rating, efficiency and MPPT inputs) come all from its type or all from its profile, never mixed. No profile declares an efficiency, so an inverter without a type has none.
- *Values.* Volts, amperes, watts and watt-hours; efficiency in %, the inverter's European weighted efficiency. Origin is an ISO 3166-1 alpha-2 code; a type may leave it out where the admin does not know it.
- *Bounds.* A type is refused when a value is unphysical: a blank maker or model, an origin that is no two-letter code, a voltage, current, power or capacity not positive and finite, an efficiency outside 0–100 % (0 excluded), an inverter without inputs, an input whose window is empty or reaches above the maximum DC input voltage, or whose start voltage lies above its window. The catalogue's plausibility ranges are its own, under the module catalogue's rules.
- *Unknown members.* A type, and a layout change at its top level, refuse a member this core does not know, as the scene does (ADR 25): a later core's additions there are refused, not dropped. A string's members are not yet checked so. Cores before this amendment ignore unknown members of a layout change; their database schema refuses a newer file whole.

**Datasheet catalogue.** Under the module catalogue's rules (ADR 17): one sheet per maker's datasheet with its title, revision and URL; every value copied from it, a missing one left out and never estimated; a sheet without its source or with a value out of range or inconsistent is refused at build time by test. An entry names the profile that reads the same model, where one exists (ADR 5). Picking an entry adds a type, so a layout never depends on the catalogue.

- *Format (2026-11-22).* A sheet holds its `source` and its `inverters` and `batteries`. An entry is the type picking it adds (`inverter` or `battery`) and, where a profile reads its model, `profile`: the profile's id and, where the family has one per model, the variant (ADR 5). The checks are pure functions of an entry, in the catalogue crate that SunReye Plan reads (ADR 25); whether a link names a profile the core serves takes the served profiles as an argument.
- *Where it lives (2026-11-23).* The format and its checks are in `packages/catalogue` beside the module catalogue: the `sunreye-catalogue` crate, pure like `pv`, and the `@sunreye/catalogue` package (ADR 25). This repository bundles no inverter or battery entry and serves no datasheet catalogue: the collected one is SunReye Plan's. A product an installer types or an agent adds passes the same checks as an entry.
- *One sheet format (2026-11-23).* Both catalogues' sheets are one format, still in separate files: a module sheet holds `maker`, `series` and `modules`, a datasheet catalogue sheet `inverters` and `batteries`; a module sheet without its maker or series is refused. Every entry, a module's included, is checked alike and refused by its model and the field out of range. The module catalogue's served sheets are unchanged; its published schema marks `maker` and `series` optional and lists the inverter and battery entries.
- *Ranges (2026-11-22).* An entry passes its type's bounds and names its maker's seat, and is refused where a value lies where no datasheet prints it, as a slip in copying shows: a maximum DC input voltage outside 30–1500 V; an AC rating outside 100 W–500 kW; an efficiency outside 80–100 % (100 excluded); an input's maximum current outside 1–100 A; a usable capacity outside 100 Wh–2 MWh; a charge or discharge power outside 100 W–1 MW, or one that would charge or empty the battery in under 15 minutes or over 20 hours; a round-trip efficiency outside 70–100 % (100 excluded); a profile link with a blank id or a variant that is no variant id.

**Origin.** Every sheet, the module catalogue's included (ADR 17), names the country of its maker's registered seat as the datasheet prints it, and the country of manufacture only where the datasheet states one, never inferred from the brand. A type copies both. SunReye Plan filters on them when a customer asks for makers from a region (ADR 25); the core only stores them.

**Not yet monitorable.** An inverter type without a profile can be planned, wired and forecast. Its device stays pending (ADR 26) until a profile for it exists.

## Decided before build (2026-11-22)

- The bounds each value is checked against: see *Bounds*.
- A hybrid inverter's battery-side voltage window waits for the EMS stage (ADR 1): nothing plans a battery's DC side before then, and adding it is additive.

## Considered options

- **Limits from profiles only.** Rejected: a planner could offer only what Home already reads.
- **Layouts referencing catalogue entries.** Rejected as for modules: a catalogue fix would silently change past layouts.
- **The profile winning over the type.** Rejected: a plan checked against a datasheet would shift when a profile is corrected.
- **One catalogue for modules, inverters and batteries.** Rejected for now: the module catalogue's endpoint is published; the two share rules and a sheet format, not a file.

## Consequences

Plan adds entries faster than core releases ship, and its organisations keep private ones. Both arrive in Home by value inside a plant document, so Home needs no catalogue update to import a plan.
