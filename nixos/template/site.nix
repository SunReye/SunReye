# Generated configuration. DO NOT EDIT.
#
# This file is a fixed mapping from `site.json` onto `appliance.*` options, and
# nothing else. `sunreye-setup` edits the JSON; this expression never changes, so
# an update from the SunReye flake cannot conflict with a local edit here.
#
# Put your own configuration in `local.nix`, which is yours and which nothing
# overwrites.
{ ... }:
let
  site = builtins.fromJSON (builtins.readFile ./site.json);
in
{
  appliance = {
    enable = true;

    ssh.authorizedKeys = site.ssh.authorizedKeys;

    tailscale = {
      enable = site.tailscale.enable;
      lan = {
        mode = site.lan.mode;
        siteId = site.lan.siteId;
      };
    };

    sunreye = {
      timeZone = site.timeZone;
      tls = site.tls;
      inverter = {
        host = site.inverter.host;
        port = site.inverter.port;
        unitId = site.inverter.unitId;
        transport = site.inverter.transport;
        simulate = site.inverter.simulate;
        profile = site.inverter.profile;
      };
    };
  };

  time.timeZone = site.timeZone;
}
