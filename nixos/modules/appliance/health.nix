# Out-of-band health reporting.
#
# Without this the only signal that a unit is sick is noticing it went offline in
# the Tailscale console — which does not distinguish "someone unplugged it" from
# "the workload has been crash-looping for a week".
#
# origin: nixos-sh-appliance@2f444121c544. Two changes. The hardcoded `haos-vm`
# lines (`vm:` / `vm-restarts:` in the report, and the module reaching into
# `systemd.services.haos-vm.onFailure`) are replaced by
# {option}`appliance.health.watchUnits`, so the layer that owns a workload names
# its units and this module stays generic. And the report gained the two
# Tailscale facts that a silently-degrading remote box actually dies of: a key
# expiring (the node vanishes from the tailnet on a date nobody remembers
# setting) and routes that are advertised but never got approved (everything
# looks enrolled, nothing behind it is reachable).
{ config, lib, pkgs, ... }:
let
  cfg = config.appliance;

  report = pkgs.writeShellApplication {
    name = "appliance-health-report";
    runtimeInputs = with pkgs; [ systemd coreutils gawk curl procps jq ]
      ++ lib.optional cfg.tailscale.enable tailscale;
    text = ''
      body=$(
      host=$(cat /run/appliance/hostname 2>/dev/null || hostname)
      echo "=== appliance health: $host ==="
      echo "uptime:    $(uptime -p)"
      echo "disk:      $(df -h --output=pcent,avail / | tail -1)"
      echo "memory:    $(free -h | awk '/^Mem:/ {print $3 " used of " $2}')"
      ${lib.concatMapStrings (unit: ''
        echo "${unit}: $(systemctl is-active ${unit} 2>/dev/null || echo absent)" \
          "(restarts: $(systemctl show ${unit} -p NRestarts --value 2>/dev/null || echo n/a))"
      '') cfg.health.watchUnits}
      echo "tailscale: $(systemctl is-active tailscaled 2>/dev/null || echo absent)"
      ${lib.optionalString cfg.tailscale.enable ''
        # A tagged node's key expires unless expiry is disabled in the console,
        # and the failure is total and silent: the node simply drops off the
        # tailnet on a date nobody wrote down. 30 days is enough warning to act
        # through a daily beacon.
        status=$(tailscale status --json 2>/dev/null || echo '{}')
        expiry=$(printf '%s' "$status" | jq -r '.Self.KeyExpiry // empty')
        if [ -n "$expiry" ]; then
          left=$(( ( $(date -d "$expiry" +%s) - $(date +%s) ) / 86400 ))
          if [ "$left" -lt 30 ]; then
            echo "key-expiry: WARNING ''${left}d left ($expiry) — disable key expiry for this node"
          else
            echo "key-expiry: ''${left}d ($expiry)"
          fi
        else
          echo "key-expiry: none (expiry disabled or not enrolled)"
        fi
        # Advertised is what this unit asked for; PrimaryRoutes is what the
        # tailnet actually approved. They differ exactly when someone forgot to
        # approve the subnet in the console — enrolment looks fine and nothing
        # behind the box is reachable.
        echo "routes-advertised: $(cat /run/appliance/routes 2>/dev/null | tr '\n' ' ' || echo none)"
        echo "routes-approved:   $(printf '%s' "$status" | jq -r '(.Self.PrimaryRoutes // []) | join(",") | if . == "" then "none" else . end')"
      ''}
      wd=""
      for d in /dev/watchdog*; do [ -e "$d" ] && wd="$wd $d"; done
      echo "watchdog: ''${wd:- NONE}"
      failed=$(systemctl list-units --state=failed --no-legend --plain | awk '{print $1}' | tr '\n' ' ')
      echo "failed:    ''${failed:-none}"
      )
      printf '%s\n' "$body"

      ${lib.optionalString (cfg.health.webhook != null) ''
        # Only bother a human when something is actually wrong, or on the daily
        # heartbeat — a webhook that fires constantly gets muted, and a muted
        # webhook is worse than none.
        if [ "''${1:-}" = "--push" ] || ! printf '%s' "$body" | grep -q 'failed:    none'; then
          url=$(cat ${toString cfg.health.webhook} 2>/dev/null || true)
          if [ -n "$url" ]; then
            curl -fsS --max-time 20 -X POST --data-binary "$body" "$url" >/dev/null \
              || echo "health webhook POST failed" >&2
          fi
        fi
      ''}
    '';
  };
in
lib.mkIf cfg.enable {
  environment.systemPackages = [ report ];

  systemd.services = lib.mkMerge [
    {
      # Anything that fails pulls this in, which puts a full health snapshot in
      # the journal next to the failure rather than making you reconstruct it
      # later.
      "appliance-failure@" = {
        description = "Record appliance health after %i failed";
        serviceConfig = {
          Type = "oneshot";
          ExecStart = "${lib.getExe report} --push";
        };
      };

      appliance-health = {
        description = "Periodic appliance health snapshot";
        startAt = "daily";
        serviceConfig = {
          Type = "oneshot";
          ExecStart = "${lib.getExe report}"
            + lib.optionalString (cfg.health.webhook != null) " --push";
        };
      };
    }
    # mkMerge, not a second `systemd.services.<name>` attribute: the watched
    # units are defined elsewhere (the workload layer), so this only contributes
    # their onFailure hook and must merge into whatever that layer declared.
    (lib.listToAttrs (map
      (unit: lib.nameValuePair unit { onFailure = [ "appliance-failure@${unit}.service" ]; })
      cfg.health.watchUnits))
  ];
}
