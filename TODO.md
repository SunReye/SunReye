# TODO

## Rename the appliance CLI

`sunreye-setup` is long for something typed constantly on a box whose whole
interface is a shell. `sunreye` reads better, and `sr` is what anyone
administering a fleet will alias anyway.

Worth deciding together rather than piecemeal:

- **`sunreye` as the name, `sr` as a shipped alias.** Two entries in
  `environment.systemPackages`, or one wrapper and a symlink.
- **Keep `sunreye-setup` working.** It is in the docs, in the login banner, in
  the health report's hints and in `/etc/issue` on every flashed box — and in
  people's shell history. A hard rename strands anyone who upgrades.
- **The tab-completion argument cuts the other way.** `sunreye-setup` is
  unambiguous after `sunre<tab>`; `sunreye` would collide with nothing today but
  might if a second binary ever ships.

27 references across the docs alone, plus `nixos/modules/sunreye/setup-cli.nix`,
`apps/appliance-cli/package.json`'s `bin`, and the strings the banner prints.

## The appliance CLI writes seeds, not settings

`sunreye-setup inverter <host>` and `simulate on|off` write `site.json`, which
becomes the container's environment — and env only SEEDS the config the first
time it is read. Once the dashboard has saved an inverter, the database is the
authority and those commands change nothing on a running box.

The docs' first-boot step still says `sunreye-setup inverter 192.168.1.100`,
which is correct for a box that has never been configured and misleading for
every other one. `simulate` now carries a warning; `inverter` does not, and the
same is true of it.

Worth deciding: either the CLI talks to the local API (it would need a
credential), or these commands say plainly that they set defaults for a fresh
install and point at the dashboard.

## First boot books the inverter's whole lifetime as today

Observed on a freshly flashed box, 05:00, first hour of data:

    Imported          3,755.7 kWh
    Exported          2,537.5 kWh
    Consumption       5,017.1 kWh
    Battery charge    4,292.8 kWh
    Battery discharge 3,857.3 kWh

Those are the inverter's LIFETIME registers. The first sample of a monotonic
counter has no predecessor, so the delta is computed against zero and the whole
of it is attributed to the bucket it was first read in — one hour, on day one.

Everything downstream inherits it: "today" totals, the energy-split percentages,
self-sufficiency, cost, and any record the statistics page thinks was set. A
lifetime is not a rate, and a box that says a household imported 3.7 MWh before
breakfast is not one anybody trusts afterwards.

### Where it is, and why the obvious fix is wrong

`apps/server/src/energy/cost.ts`, `intraBucketBase`. A bucket with no
predecessor falls back to its own `max - min`. That is right in normal
operation, and wrong when the bucket holds two incompatible levels.

It already handles one of the two mirror cases — a counter that RESTARTED
inside the bucket leaves a stale HIGH level in `(min, max]`, and only the rise
above it was observed. The unhandled mirror is a spurious ZERO: a register a
real inverter has not populated on its first poll or two, sitting under a
lifetime reading. `max - 0` then prices the whole odometer into one hour.

**Do not "fix" it by treating `min === 0` as unusable.** Tried: it breaks nine
existing tests in `cost.test.ts`, because a counter that genuinely starts at
zero is normal and its first bucket must count. The two cases are
indistinguishable from `(min, max)` alone.

What would separate them:

  * the counter's UNIT, so "rose 3,755 in an hour" can be judged implausible —
    but that varies per metric (kWh for most, Wh for some);
  * the sample COUNT or the first sample's timestamp inside the bucket, which
    the rollup does not currently carry;
  * or refusing to record a zero for a cumulative register at the source, in
    the poll loop, where the profile's metric kind is known.

The third is probably the right one and is a change to the write path, not the
read path. Needs the raw `metrics_raw` rows from a box's first hour to confirm
the zero is there at all — everything above is inference from the aggregate.
