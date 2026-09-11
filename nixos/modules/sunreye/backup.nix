# Weekly logical backups.
#
# Small, and not the main restore story — the appliance's real protection is that
# the raw metrics are kept for years and the rollups can be rebuilt from them.
# What this buys is the other failure: the disk, or the box, or the house. A
# custom-format dump of a compressed hypertable is a fraction of the datadir, so
# four of them are affordable on a 256 GB stick.
#
# It is also load-bearing for the layer below: the disk guard and the ballast
# reserve in `modules/appliance` are sized on the assumption that something
# writes into /var/lib/sunreye on a schedule and prunes itself. An unbounded
# backup directory is exactly the slow leak those two exist to survive.
{ config, lib, pkgs, ... }:
let
  cfg = config.appliance.sunreye;
  stateDir = "/var/lib/sunreye";
  backupDir = "${stateDir}/backups";
in
lib.mkIf (config.appliance.enable && cfg.enable && cfg.backup.enable) {
  systemd.services.sunreye-backup = {
    description = "Dump the SunReye database";
    requires = [ "podman-sunreye-postgres.service" ];
    after = [ "podman-sunreye-postgres.service" ];
    path = with pkgs; [ coreutils findutils ] ++ [ config.virtualisation.podman.package ];
    serviceConfig = {
      Type = "oneshot";
      # A dump of a multi-year hypertable is not a 90-second job.
      TimeoutStartSec = "2h";
    };
    script = ''
      set -euo pipefail
      install -d -m 0700 ${backupDir}

      # Refuse rather than fill the disk. A backup that takes a headless box to
      # 100% is a worse outcome than a backup that did not happen: the first one
      # needs a site visit, the second one sends a health report.
      avail=$(df -B1 --output=avail ${stateDir} | tail -1)
      if [ "$avail" -lt 2147483648 ]; then
        echo "only $(numfmt --to=iec "$avail") free under ${stateDir}; skipping this dump" >&2
        exit 0
      fi

      stamp=$(date -u +%Y%m%dT%H%M%SZ)
      out=${backupDir}/sunreye-$stamp.dump

      # -Fc: the custom format, so a restore can be selective and parallel-free
      # (pg_restore -j silently corrupts a Timescale catalog — restores here must
      # be serial). Written to a .partial and renamed, so an interrupted dump can
      # never be mistaken for a good one by whoever is restoring at 2am.
      podman exec sunreye-postgres \
        pg_dump -U postgres -d SunReye -Fc > "$out.partial"
      mv "$out.partial" "$out"
      echo "wrote $out ($(du -h "$out" | cut -f1))"

      # Prune by count, newest kept. Partials from a previous failed run go too.
      rm -f ${backupDir}/*.partial
      ls -1t ${backupDir}/sunreye-*.dump 2>/dev/null \
        | tail -n +$((${toString cfg.backup.keep} + 1)) \
        | while read -r old; do echo "pruning $old"; rm -f "$old"; done
    '';
  };

  systemd.timers.sunreye-backup = {
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnCalendar = "weekly";
      # An hour of jitter, and a run on the next boot if the box was off when the
      # timer was due — an appliance that is unplugged for a fortnight should not
      # silently skip a fortnight of backups.
      RandomizedDelaySec = "1h";
      Persistent = true;
    };
  };

  appliance.health.watchUnits = [ "sunreye-backup" ];
}
