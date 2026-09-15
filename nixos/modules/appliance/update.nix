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

  # An identity for the lock commit, because git refuses to make one without it:
  #
  #   fatal: unable to auto-detect email address (got 'root@sr-…(none)')
  #   error: program "git" failed with exit code 128
  #
  # `--commit-lock-file` shells out to `git commit`, and a flashed box has no
  # identity to auto-detect — so every upgrade that actually had a new revision
  # to lock died at the commit. The lock is WRITTEN before the commit is
  # attempted, so the next run found nothing to update, committed nothing and
  # succeeded: the timer failed every night it had work and passed every night it
  # did not, which is indistinguishable from a box that is simply up to date.
  #
  # On the unit rather than in /etc/gitconfig: this identity exists for one
  # commit made by one service, and a system-wide one would silently author an
  # operator's own commits in /etc/nixos as the appliance.
  #
  # `.invalid` is reserved by RFC 2606 and can never be delivered to — the commit
  # needs a syntactically valid address, not a reachable one.
  systemd.services.nixos-upgrade.environment = {
    GIT_AUTHOR_NAME = "SunReye appliance";
    GIT_AUTHOR_EMAIL = "appliance@sunreye.invalid";
    GIT_COMMITTER_NAME = "SunReye appliance";
    GIT_COMMITTER_EMAIL = "appliance@sunreye.invalid";
  };

  # Keep enough generations that --rollback is a real option, and not so many that
  # the store outgrows the disk.
  nix.gc.options = lib.mkForce "--delete-older-than 30d";
}
