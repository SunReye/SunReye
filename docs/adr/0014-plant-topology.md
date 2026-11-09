# 14. Plant topology

Status: accepted (2026-11-08), amended (2026-11-09)

## Context

A home with a grid meter, an inverter, a battery and a heat-pump sub-meter has overlapping measurements. Summing roles double-counts as soon as two devices measure the same flow; v4 derived plant aggregates from role names and hit that limit with more than one device. Self-consumption, house load and any EMS decision need to know what measures what.

## Decision

- A plant is a tree of **measurement points**. A point names a device and the roles it measures there, and has a parent. The root is the grid connection point.
- A point's own consumption is its measured power minus its measured children. The part no child explains is shown as an explicit "unmeasured" remainder, never hidden.
- Two devices claiming the same point are flagged, not summed: the point reads its first claim that has a value.
- A point is measured by one power role, whose sign convention (ADR 4) says which way power flows: `grid.power` at the root and nowhere else; `battery.power`, `load.power`, `backup.power` and `ev.charge.power` into the point; `pv.power` and `generator.power` out of it. A point whose reading is missing or stale is unmeasured, and its parent subtracts its nearest measured descendants instead.
- The house load is all consumption except the battery's charging: the own consumption of the root and of every consuming point, summed. Like every plant total, it is published only while every point it needs is measured. Sums of the points measured by one role give the plant's `grid.power`, `pv.power`, `generator.power`, `battery.power` and `ev.charge.power`. One battery gives its own state of charge; several give one only while each reports its capacity.
- Plant aggregates (house load, self-consumption, autarky, flows between grid, PV, battery, heat pump and EV) are computed from the tree and published as readings of a computed `plant` device (ADR 15). They are stored and rolled up like any reading, and are the only plant-level values (ADR 4).
- The `plant` device balances the tree in force at each reading over every point's latest reading younger than the gap threshold (ADR 3). It publishes its totals under the roles its devices use, and each measured point's own consumption as `point.power` indexed by point id (ADR 4). An unchanged value is published once a poll cadence, so it is neither a gap nor a flood on the bus.
- Setup proposes a tree from the devices' capabilities (an inverter with its grid meter, PV and battery); the admin adjusts it in the SPA.
- An energy balance check reports the residual per day, so a missing or misplaced point is visible.

## Considered options

- **Aggregates from role names (v4).** Rejected: breaks with two meters on one flow.
- **Admin-written formulas.** Rejected: error-prone for homeowners and impossible to validate.

## Consequences

A topology change applies from its date; aggregates already stored keep the topology they were computed with, the same rule as a timezone change (ADR 3).
