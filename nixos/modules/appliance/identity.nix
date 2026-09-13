# Deterministic per-unit naming.
#
# origin: nixos-sh-appliance@2f444121c544 (unchanged).
#
# `networking.hostName` MUST be empty here, and that is not a stylistic choice.
#
# I first set a placeholder and renamed on top of it, reasoning that an unset
# hostname makes early journal lines and the DHCP hostname option wrong. Booting
# the image disproved it twice:
#
#   1. `hostnamectl set-hostname` fails outright — NixOS makes /etc/hostname a
#      symlink into the read-only store whenever networking.hostName is set:
#      "Could not set static hostname: /etc/hostname is in a read-only filesystem."
#   2. `hostnamectl --transient set-hostname` then *appears* to succeed, and is
#      silently reverted: systemd-hostnamed gives the static hostname priority, so
#      the transient name never survives.
#
# With hostName = "", nixpkgs emits no /etc/hostname at all, there is no static
# name to win the tie, and the transient set sticks — verified on a booted image:
#
#   static:              (empty)
#   TRANSIENT: sr-821813fe9915
#   KERNEL:    sr-821813fe9915
#
# The cost is smaller than I assumed: the pre-rename name is nixpkgs' default
# "nixos", not nothing, so early journal lines are merely generic rather than
# broken. Renaming on top of a placeholder is what does not work.
{ config, lib, pkgs, ... }:
let
  cfg = config.appliance;
in
lib.mkIf cfg.enable {
  networking.hostName = lib.mkDefault "";

  systemd.services.appliance-identity = {
    description = "Derive this appliance's stable hostname";
    wantedBy = [ "multi-user.target" ];
    before = [ "tailscaled.service" "network-online.target" ];
    after = [ "systemd-machine-id-commit.service" ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      # hostnamed may not have settled on a slow first boot; do not leave the unit
      # dead and the appliance anonymous because of a transient dbus race.
      Restart = "on-failure";
      RestartSec = "3s";
    };
    unitConfig = {
      StartLimitBurst = 5;
      StartLimitIntervalSec = "2min";
    };
    path = with pkgs; [ coreutils systemd gnused ];
    script = ''
      set -euo pipefail

      sanitize() {
        # DNS-safe: alphanumerics and hyphens, collapsed, trimmed, lowercased.
        tr -c '[:alnum:]' '-' \
          | tr -s '-' \
          | sed 's/^-//; s/-$//' \
          | tr '[:upper:]' '[:lower:]'
      }

      # A DMI serial is only useful if the vendor actually filled it in. The set of
      # junk values is much wider than a five-string denylist: match on the
      # normalised form and require some minimum entropy.
      identifier=""
      if [ -r /sys/class/dmi/id/product_serial ]; then
        raw=$(cat /sys/class/dmi/id/product_serial 2>/dev/null || true)
        norm=$(printf '%s' "$raw" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
        if [ -n "$norm" ]; then
        case "$norm" in
          none|na|n/a|default|defaultstring|tobefilledbyoem|tobefilledbyo.e.m.|\
          systemserialnumber|serialnumber|0|00000000|0123456789|123456789|\
          123456789abc|unknown|invalid|oem|chassisserialnumber)
            ;;
          *)
            # Reject all-same-character strings (000000, xxxxxx, ...).
            first=$(printf '%s' "$norm" | cut -c1)
            if [ "''${#norm}" -ge 4 ] && [ -n "$(printf '%s' "$norm" | tr -d "$first")" ]; then
              identifier=$(printf '%s' "$raw" | sanitize)
            fi
            ;;
        esac
        fi
      fi

      # Fall back to machine-id, not the MAC. machine-id is unique, stable, and
      # survives a NIC replacement — and it still exists if net.ifnames=0 failed to
      # take and there is no interface called "${cfg.network.uplink}" at all.
      if [ -z "$identifier" ]; then
        identifier=$(cut -c1-12 /etc/machine-id)
      fi

      hostname="${lib.toLower cfg.namePrefix}-''${identifier}"
      hostname=$(printf '%s' "$hostname" | cut -c1-63)

      # --transient, not the static hostname. NixOS makes /etc/hostname a symlink
      # into the read-only store whenever networking.hostName is set, so
      # `hostnamectl set-hostname` fails with "read-only filesystem" — verified by
      # booting this image. The transient hostname is the kernel hostname, which is
      # what the network, the journal and Tailscale actually read; the derivation is
      # deterministic and re-runs every boot, so nothing needs to persist.
      current=$(hostnamectl --transient 2>/dev/null || cat /proc/sys/kernel/hostname)
      if [ "$current" != "$hostname" ]; then
        echo "naming this appliance: $hostname (was: ''${current:-unset})"
        hostnamectl --transient set-hostname "$hostname"
      else
        echo "hostname already correct: $hostname"
      fi

      # Consumed by tailscale-autoconnect and the health beacon.
      install -d -m 0755 /run/appliance
      printf '%s\n' "$hostname" > /run/appliance/hostname
    '';
  };
}
