# 4. Roles and conventions

Status: accepted (2026-11-08), amended (2026-11-09, 2026-11-12, 2026-11-13)

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
| `battery.cycles` | | counter; the vendor's own cycle count | |
| `battery.energy.charged.total`, `battery.energy.discharged.total` | kWh | counter | |
| `grid.power` | W | measurement | yes |
| `grid.frequency` | Hz | measurement | |
| `grid.phase.voltage` / `.current` / `.power` | V / A / W | measurement, indexed | current, power |
| `grid.energy.imported.total`, `grid.energy.exported.total` | kWh | counter | |
| `battery.charge.power`, `battery.discharge.power` | W | measurement; the plant's `battery.power` while it charges, and while it discharges, else 0; published only by the `plant` device (ADR 14) | |
| `grid.import.power`, `grid.export.power` | W | measurement; the plant's `grid.power` while it buys, and while it feeds in, else 0; published only by the `plant` device (ADR 14) | |
| `self.consumption.power` | W | measurement; the plant's PV power not fed in, published only by the `plant` device (ADR 14) | |
| `self.supply.power` | W | measurement; the plant's house load not bought, published only by the `plant` device (ADR 14) | |
| `inverter.power` | W | measurement; the inverter's AC output, positive when it delivers AC | yes |
| `inverter.loss.power` | W | measurement; what the inverter takes in from PV, the battery and the grid and does not give out to the loads, the battery and the grid (v3's own use) | |
| `inverter.efficiency` | % | measurement; what the inverter gives out to the loads, the battery and the grid over what it takes in from PV, the battery and the grid (v3's definition), in 0 to 100; 0 while nothing goes in | |
| `inverter.temperature` | °C | measurement; the hottest sensor the profile maps, usually the heatsink | |
| `inverter.status` | | status; the operating state through an `enum`: 0 standby, 1 normal, 2 fault | |
| `load.power`, `backup.power`, `generator.power` | W | measurement | |
| `load.phase.power` | W | measurement, indexed by phase | |
| `load.energy.total`, `backup.energy.total`, `generator.energy.total` | kWh | counter | |
| `point.power` | W | measurement, indexed by measurement point id; a point's own consumption, published only by the `plant` device (ADR 14) | yes |
| `ev.charge.power`, `ev.vehicle.soc`, `ev.session.energy` | W, %, kWh | measurement, measurement, counter | |
| `ev.connected`, `ev.charging` | | status | |
| `ev.limit.soc` | % | measurement; the vehicle charge limit a loadpoint charges to (ADR 10) | |
| `ev.mode`, `ev.battery.boost` | | status; a loadpoint's charge mode and whether it may drain the house battery (ADR 10) | |
| `weather.ghi`, `weather.dni`, `weather.dhi` | W/m² | measurement; global, direct normal and diffuse irradiance (ADR 17) | |
| `weather.temperature`, `weather.wind` | °C, m/s | measurement | |
| `price.import`, `price.export` | EUR/kWh | measurement; what a kWh bought costs and a kWh fed in earns (ADR 12) | yes |
| `price.spot` | EUR/kWh | measurement; the bidding zone's day-ahead price for the slot in force, published only by the spot-price device (ADR 12) | yes |
| `cost.import.rate`, `cost.export.rate`, `cost.savings.rate` | EUR/h | measurement; paid for what is bought, earned for what is fed in, and saved against buying the whole house load, published only by the tariff device (ADR 12) | yes |

- **Plant values.** A role has no rule for combining devices. Plant-level values come only from the `plant` computed device and its topology (ADR 14), which weights `battery.soc` by `battery.capacity`.
- **Self-consumption and autarky** are a day's or period's energy shares, not readings: `self.consumption.power` over `pv.power`, and `self.supply.power` over `load.power`. A percentage reading would roll up as a time-weighted mean (ADR 3), and a night at 0 % would weigh as much as a noon at 100 % whatever the energy behind each.
- **Inverter efficiency** is a reading of the moment, computed by the inverter's profile from its own PV, battery, grid and load powers, not by the `plant` device: the plant's house load includes the loss, so its ratio would always read 100 %. Its rollup is a time-weighted mean, not a period's efficiency. The SPA shows it only while it is above 0.
- **Usable capacity** is inferred, never read: no vendor register reports battery health. Each unbroken discharge in the plant's hourly rollups (ADR 3) of `battery.soc` and `battery.power` measures its energy out over the charge it used: hours without a gap whose integral discharges and whose power never charges above 50 W, consecutive, falling at least 20 points from the first hour's maximum to the last hour's minimum. The estimate is the median of the latest five measurements, its reference the plant's `battery.capacity` or else the median of the first five, never a maximum, which noise biases upward. A change per year needs more than five measurements over half a year. Hourly rollups cannot trim the 10 to 95 % band where a BMS recalibrates; the median absorbs those jumps.
- **Reserved namespaces** for the workspace, with roles added by amendment as devices need them: `load.circuit` (indexed sub-meters), `heatpump` (power, thermal energy, SG Ready state), `heat` (thermal energy in kWh), `gas` and `water` (volume counters in m³), `weather` (global, direct and diffuse irradiance in W/m², temperature, wind; ADR 17), `forecast` (future values of any role, ADR 15), `price` (import, export and spot in EUR/kWh), `cost` (signed rates in EUR/h, ADR 12) and `plan` (EMS decisions).
- **Signs.** `grid.power` is positive when importing. `battery.power` and `battery.current` are positive when charging. `inverter.power` is positive when the inverter delivers AC, negative when it charges the battery from AC. `point.power` is positive when the point consumes. `price.*` and `cost.*` are signed: spot prices go negative (ADR 12). Everything else is non-negative. The decoder converts at read time; no consumer converts. Outbound adapters convert at their own edge (ADR 10).
- **No day counters.** A device's "today" counters reset on their own schedule; the core derives days from rollups (ADR 3).
- **Extras.** A quantity with no role is stored as `extra.<name>` and hidden by default.
- **Deadband defaults,** by unit: W 5, V 0.5, A 0.1, Hz 0.02, °C 0.5, % 0 (state of charge moves in 1 % steps). They sit below the metering accuracy of typical home inverters (about 1 to 2 % of reading) and above last-digit jitter: chosen from known device behaviour, not measured. A profile may declare another per role for its hardware. An admin may override per device and role. Precedence: override, profile, role default, none. An override below the register's quantisation step is refused, counters and enums refuse any, and a deadband is absolute, in the role's unit.

## Considered options

- **Efficiency as AC output over PV power (v5 until 2026-11-13).** Rejected: above 100 % whenever the battery discharges, and meaningless at night.
- **Self-consumption and autarky as percentage roles.** Rejected: their rollups would be time-weighted, not energy-weighted, and a period's share could not be read from them.
- **Per-vendor conventions, converted by consumers.** Rejected: v4 hit a battery power sign contradiction in exactly this seam.
- **Relative deadbands.** Rejected: a second mechanism; an absolute value per unit covers home-scale ranges.

## Consequences

Adding a role is an ADR amendment, because every adapter and the SPA must handle it.
