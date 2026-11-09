# 4. Roles and conventions

Status: accepted (2026-11-08), amended (2026-11-09)

## Context

Every profile maps its native quantities to roles; storage, the API, the SPA and EVCC read only roles. Vendors disagree on signs: Sungrow's meter reads positive when buying, Huawei's when feeding in; SolaX, Huawei and E3/DC report battery charge as positive, Kostal as negative.

## Decision

Roles are dotted lowercase names. Each has a kind and a unit, and a sign convention if signed. An indexed role carries an MPPT input, string or phase index. Kinds: `measurement`, `counter` (a monotonic lifetime total) and `status` (an enum).

| Role | Unit | Kind | Signed |
| --- | --- | --- | --- |
| `pv.power` | W | measurement | |
| `pv.mppt.power` / `.voltage` / `.current` | W / V / A | measurement, indexed by MPPT input | |
| `pv.string.power` | W | measurement, indexed by string id; estimated unless alone on its MPPT input (ADR 17) | |
| `pv.energy.total` | kWh | counter | |
| `battery.soc` | % | measurement | |
| `battery.capacity` | kWh | measurement | |
| `battery.power` | W | measurement | yes |
| `battery.current` | A | measurement | yes |
| `battery.voltage`, `battery.temperature` | V, °C | measurement | |
| `battery.mode` | | status | |
| `battery.energy.charged.total`, `battery.energy.discharged.total` | kWh | counter | |
| `grid.power` | W | measurement | yes |
| `grid.frequency` | Hz | measurement | |
| `grid.phase.voltage` / `.current` / `.power` | V / A / W | measurement, indexed | current, power |
| `grid.energy.imported.total`, `grid.energy.exported.total` | kWh | counter | |
| `load.power`, `backup.power`, `generator.power` | W | measurement | |
| `load.energy.total`, `backup.energy.total`, `generator.energy.total` | kWh | counter | |
| `point.power` | W | measurement, indexed by measurement point id; a point's own consumption, published only by the `plant` device (ADR 14) | yes |
| `ev.charge.power`, `ev.vehicle.soc`, `ev.session.energy` | W, %, kWh | measurement, measurement, counter | |
| `ev.connected`, `ev.charging` | | status | |
| `ev.limit.soc` | % | measurement; the vehicle charge limit a loadpoint charges to (ADR 10) | |
| `ev.mode`, `ev.battery.boost` | | status; a loadpoint's charge mode and whether it may drain the house battery (ADR 10) | |
| `ev.vehicle.model` | | status; the car catalogue entry the connected vehicle's title names (ADR 20) | |
| `weather.ghi`, `weather.dni`, `weather.dhi` | W/m² | measurement; global, direct normal and diffuse irradiance (ADR 17) | |
| `weather.temperature`, `weather.wind` | °C, m/s | measurement | |
| `price.import`, `price.export` | EUR/kWh | measurement; what a kWh bought costs and a kWh fed in earns (ADR 12) | yes |
| `cost.import.rate`, `cost.export.rate`, `cost.savings.rate` | EUR/h | measurement; paid for what is bought, earned for what is fed in, and saved against buying the whole house load, published only by the tariff device (ADR 12) | yes |

- **Plant values.** A role has no rule for combining devices. Plant-level values come only from the `plant` computed device and its topology (ADR 14), which weights `battery.soc` by `battery.capacity`.
- **Reserved namespaces** for the workspace, with roles added by amendment as devices need them: `load.circuit` (indexed sub-meters), `heatpump` (power, thermal energy, SG Ready state), `heat` (thermal energy in kWh), `gas` and `water` (volume counters in m³), `weather` (global, direct and diffuse irradiance in W/m², temperature, wind; ADR 17), `forecast` (future values of any role, ADR 15), `price` (import and export in EUR/kWh), `cost` (signed rates in EUR/h, ADR 12) and `plan` (EMS decisions).
- **Signs.** `grid.power` is positive when importing. `battery.power` and `battery.current` are positive when charging. `point.power` is positive when the point consumes. `price.*` and `cost.*` are signed: spot prices go negative (ADR 12). Everything else is non-negative. The decoder converts at read time; no consumer converts. Outbound adapters convert at their own edge (ADR 10).
- **No day counters.** A device's "today" counters reset on their own schedule; the core derives days from rollups (ADR 3).
- **Extras.** A quantity with no role is stored as `extra.<name>` and hidden by default.
- **Deadband defaults,** by unit: W 5, V 0.5, A 0.1, Hz 0.02, °C 0.5, % 0 (state of charge moves in 1 % steps). They sit below the metering accuracy of typical home inverters (about 1 to 2 % of reading) and above last-digit jitter: chosen from known device behaviour, not measured. A profile may declare another per role for its hardware. An admin may override per device and role. Precedence: override, profile, role default, none. An override below the register's quantisation step is refused, counters and enums refuse any, and a deadband is absolute, in the role's unit.

## Considered options

- **Per-vendor conventions, converted by consumers.** Rejected: v4 hit a battery power sign contradiction in exactly this seam.
- **Relative deadbands.** Rejected: a second mechanism; an absolute value per unit covers home-scale ranges.

## Consequences

Adding a role is an ADR amendment, because every adapter and the SPA must handle it.
