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
