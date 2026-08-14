# SunReye (beta)

Pre-release builds of the [SunReye addon](../sunreye/README.md), built from the
`dev` branch. Installs alongside the stable addon with a separate database, so
you can try unreleased changes without touching production data.

**Not for production.** Migrations here may still change before release, and
downgrading back to the stable addon is not supported — take a Home Assistant
backup first.

Most inverters accept only one Modbus TCP connection at a time, so stop the
stable addon before starting this one, or run it with `inverter_simulate`.
