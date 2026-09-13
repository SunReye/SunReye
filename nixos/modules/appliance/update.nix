# Unattended host updates.
#
# origin: nixos-sh-appliance@2f444121c544. One addition: `flags`, so the flake
# ref can be a path on the box (`/etc/nixos`) whose single pinned input is bumped
# on each run. Without it a local flake would rebuild the identical closure every
# night and never actually update — the pin is the whole point of a local flake,
# and the flags are what move it.
{ config, lib, ... }:
let
  cfg = config.appliance;
  au = cfg.autoUpgrade;
in
lib.mkIf (cfg.enable && au.enable) {
  assertions = [{
    assertion = au.flake != null;
    message = "appliance.autoUpgrade.enable requires appliance.autoUpgrade.flake.";
  }];

  system.autoUpgrade = {
    enable = true;
    flake = au.flake;
    flags = au.flags;
    dates = au.dates;
    randomizedDelaySec = "45min";
    # Explicitly not allowReboot. Updates stage into the next boot and the
    # operator reboots deliberately: an unattended reboot of a box that is
    # someone's live energy monitor is not ours to take, and a kernel update
    # that does not boot is a site visit.
    allowReboot = false;
  };

  # Keep enough generations that --rollback is a real option, and not so many that
  # the store outgrows the disk.
  nix.gc.options = lib.mkForce "--delete-older-than 30d";
}
