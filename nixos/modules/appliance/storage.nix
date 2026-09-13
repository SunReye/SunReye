# Storage hygiene: keep a 256 GB appliance from filling itself over years of
# unattended operation, without grinding the flash to do it.
#
# origin: nixos-sh-appliance@2f444121c544 (comments retargeted from the HAOS VM
# to a containerised workload; the values are unchanged and were measured).
{ config, lib, pkgs, ... }:
let
  cfg = config.appliance;
in
lib.mkIf cfg.enable {
  services.fstrim.enable = true;

  # Postgres lives on the bare root filesystem here, not inside a disk image, so
  # fstrim reaches the blocks it frees directly. That is one of the reasons the
  # appliance runs the database in a container over a bind mount rather than in a
  # VM: with a qcow2 in the way, a host fstrim reclaims nothing the guest deleted
  # unless the image is opened with discard=unmap, and the "storage hygiene"
  # story is only half true.

  boot.tmp.useTmpfs = true;
  # Default is 50% of RAM = 4 GB on an 8 GB box. A tmpfs is charged to RAM as it
  # fills, so that default lets one large /tmp write — a pg_dump written to the
  # wrong place, a container image unpacked by hand — take memory away from
  # Postgres and make it the OOM killer's biggest target. 512M is more than the
  # workload needs and small enough that overrunning it is an ENOSPC, which is a
  # recoverable error, rather than an OOM kill, which is not.
  boot.tmp.tmpfsSize = "512M";

  services.journald.extraConfig = ''
    SystemMaxUse=150M
    SystemMaxFileSize=20M
    MaxRetentionSec=1month
  '';

  nix = {
    gc = {
      automatic = true;
      dates = "weekly";
      options = "--delete-older-than 14d";
      randomizedDelaySec = "30min";
    };

    # auto-optimise-store is deliberately OFF. It is valid and it does work — it
    # emits `auto-optimise-store = true` into nix.conf — but it hardlink-scans the
    # whole store on every build, which is a lot of metadata churn on flash for a
    # device that has one generation and never builds anything locally.
    settings = {
      auto-optimise-store = false;
      min-free = 512 * 1024 * 1024;
      max-free = 2048 * 1024 * 1024;
      experimental-features = [ "nix-command" "flakes" ];
    };
  };

  # A headless box with a full root is close to unrecoverable remotely. Shout early.
  systemd.services.appliance-disk-guard = {
    description = "Warn when appliance storage is running low";
    startAt = "hourly";
    serviceConfig.Type = "oneshot";
    path = [ pkgs.coreutils ];
    script = ''
      pct=$(df --output=pcent / | tail -1 | tr -dc '0-9')
      avail=$(df -h --output=avail / | tail -1 | tr -d ' ')
      if [ "$pct" -ge 90 ]; then
        echo "CRITICAL: root filesystem ''${pct}% full ($avail free)" >&2
        exit 1
      elif [ "$pct" -ge 80 ]; then
        echo "WARNING: root filesystem ''${pct}% full"
      fi
    '';
  };
}
