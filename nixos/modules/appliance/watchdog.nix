# Hardware watchdog.
#
# origin: nixos-sh-appliance@2f444121c544 (unchanged).
#
# Uses systemd's own watchdog rather than services.watchdogd. Reading
# nixos/modules/services/monitoring/watchdogd.nix on 26.05, that module's unit is
# literally `{ ExecStart, Type }` — no Restart= — and `safe-exit` defaults to true,
# meaning the daemon *disarms the WDT on its way out*. Together: if watchdogd dies
# or is stopped, the hardware watchdog is switched off and never comes back, and the
# appliance looks healthy while having no protection at all.
#
# systemd's watchdog has none of that: PID 1 pets the device, there is no separate
# process to crash, and nothing disarms on exit.
{ config, lib, pkgs, ... }:
let
  cfg = config.appliance.watchdog;
in
lib.mkIf (config.appliance.enable && cfg.enable) {
  # (systemd.watchdog.* was renamed to systemd.settings.Manager.* — use the
  # current names so this does not warn on every build.)
  systemd.settings.Manager = {
    RuntimeWatchdogSec = cfg.runtimeTime;
    RebootWatchdogSec = cfg.rebootTime;
  };

  # The plan's original `interval = 10` against watchdogd's default `timeout = 15`
  # left a 5-second margin. That is a spurious-reboot generator on a box whose I/O
  # can stall — and chasing phantom resets on a customer site is expensive. The
  # defaults here are 30s/10m.

  systemd.services.appliance-watchdog-check = lib.mkIf cfg.requireDevice {
    description = "Verify a hardware watchdog device is present";
    wantedBy = [ "multi-user.target" ];
    after = [ "systemd-modules-load.service" ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
    };
    script = ''
      found=""
      for d in /dev/watchdog*; do [ -e "$d" ] && found="$found $d"; done
      if [ -n "$found" ]; then
        echo "hardware watchdog present:$found"
      else
        echo "WARNING: no /dev/watchdog device found." >&2
        echo "This SKU's BIOS may hide the TCO watchdog (iTCO_wdt)." >&2
        echo "The appliance has NO hardware reset protection. Kernel panic recovery" >&2
        echo "still works via panic=10, but a userspace or driver lockup will hang." >&2
      fi
    '';
  };

  # Present on most Intel platforms; harmless where absent.
  boot.kernelModules = [ "iTCO_wdt" "iTCO_vendor_support" ];
}
