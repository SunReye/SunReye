# 4. Roles and conventions

Status: proposed (2026-11-08)

## Context

Every profile maps its native quantities to roles; storage, the API, the SPA and EVCC read only roles. Vendors disagree on signs: Sungrow's meter reads positive when buying, Huawei's when feeding in; SolaX, Huawei and E3/DC report battery charge as positive, Kostal as negative.

## Decision

Roles are dotted lowercase names. Each has a kind and a unit, a sign convention if signed, and a rule for combining devices. An indexed role carries a string or phase index. Kinds: `measurement`, `counter` (a monotonic lifetime total) and `status` (an enum).

| Role | Unit | Kind | Combine | Signed |
| --- | --- | --- | --- | --- |
| `pv.power` | W | measurement | sum | |
| `pv.string.power` / `.voltage` / `.current` | W / V / A | measurement, indexed | per device | |
| `pv.energy.total` | kWh | counter | sum | |
| `battery.soc` | % | measurement | weighted mean | |
| `battery.power` | W | measurement | sum | yes |
| `battery.current` | A | measurement | per device | yes |
| `battery.voltage`, `battery.temperature` | V, °C | measurement | per device, weighted mean | |
| `battery.mode` | | status | per device | |
| `battery.energy.charged.total`, `battery.energy.discharged.total` | kWh | counter | sum | |
| `grid.power` | W | measurement | sum | yes |
| `grid.frequency` | Hz | measurement | per device | |
| `grid.phase.voltage` / `.current` / `.power` | V / A / W | measurement, indexed | per device | current, power |
| `grid.energy.imported.total`, `grid.energy.exported.total` | kWh | counter | sum | |
| `load.power`, `backup.power`, `generator.power` | W | measurement | sum | |
| `load.energy.total`, `backup.energy.total`, `generator.energy.total` | kWh | counter | sum | |
| `ev.charge.power`, `ev.vehicle.soc`, `ev.session.energy` | W, %, kWh | measurement, measurement, counter | per device | |
| `ev.connected`, `ev.charging` | | status | per device | |

- **Signs.** `grid.power` is positive when importing. `battery.power` and `battery.current` are positive when charging. Everything else is non-negative. The decoder converts at read time; no consumer converts. Outbound adapters convert at their own edge (ADR 10).
- **No day counters.** A device's "today" counters reset on their own schedule; the core derives days from rollups (ADR 3).
- **Extras.** A quantity with no role is stored as `extra.<name>` and hidden by default.
- **Deadband defaults,** by unit: W 5, V 0.5, A 0.1, Hz 0.02, °C 0.5, % 0 (state of charge moves in 1 % steps). They sit below the metering accuracy of typical home inverters (about 1 to 2 % of reading) and above last-digit jitter: chosen from known device behaviour, not measured. A profile may declare another per role for its hardware. An admin may override per device and role. Precedence: override, profile, role default, none. An override below the register's quantisation step is refused, counters and enums refuse any, and a deadband is absolute, in the role's unit.

## Considered options

- **Per-vendor conventions, converted by consumers.** Rejected: v4 hit a battery power sign contradiction in exactly this seam.
- **Relative deadbands.** Rejected: a second mechanism; an absolute value per unit covers home-scale ranges.

## Consequences

Adding a role is an ADR amendment, because every adapter and the SPA must handle it.
