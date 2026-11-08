# 14. Plant topology

Status: accepted (2026-11-08), amended (2026-11-08)

## Context

A home with a grid meter, an inverter, a battery and a heat-pump sub-meter has overlapping measurements. Summing roles double-counts as soon as two devices measure the same flow; v4 derived plant aggregates from role names and hit that limit with more than one device. Self-consumption, house load and any EMS decision need to know what measures what.

## Decision

- A plant is a tree of **measurement points**. A point names a device and the roles it measures there, and has a parent. The root is the grid connection point.
- A point's own consumption is its measured power minus its measured children. The part no child explains is shown as an explicit "unmeasured" remainder, never hidden.
- Two devices claiming the same point are flagged, not summed.
- Plant aggregates (house load, self-consumption, autarky, flows between grid, PV, battery, heat pump and EV) are computed from the tree and published as readings of a computed `plant` device (ADR 15). They are stored and rolled up like any reading, and are the only plant-level values (ADR 4).
- Setup proposes a tree from the devices' capabilities (an inverter with its grid meter, PV and battery); the admin adjusts it in the SPA.
- An energy balance check reports the residual per day, so a missing or misplaced point is visible.

## Considered options

- **Aggregates from role names (v4).** Rejected: breaks with two meters on one flow.
- **Admin-written formulas.** Rejected: error-prone for homeowners and impossible to validate.

## Consequences

A topology change applies from its date; aggregates already stored keep the topology they were computed with, the same rule as a timezone change (ADR 3).
