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
    runtimeInputs = with pkgs; [ systemd coreutils gawk curl procps jq openssl ]
      ++ lib.optional cfg.tailscale.enable tailscale;
    text = ''
      body=$(
      # `uname -n` rather than `hostname`: the latter is not in this wrapper's
      # PATH, so the fallback died precisely when it was needed — the file is
      # written by appliance-identity, and the case this branch exists for is
      # that unit having failed.
      host=$(cat /run/appliance/hostname 2>/dev/null || uname -n)
      echo "=== appliance health: $host ==="
      # procps by explicit path: coreutils ships an `uptime` of its own, it
      # comes first in this wrapper's PATH, and it has no -p. The report showed
      # an empty uptime on every box until `checks.health-report` ran it.
      echo "uptime:    $(${pkgs.procps}/bin/uptime -p)"
      echo "disk:      $(df -h --output=pcent,avail / | tail -1)"
      echo "memory:    $(free -h | awk '/^Mem:/ {print $3 " used of " $2}')"
      ${lib.concatMapStrings (unit: ''
        # The fallback is applied to the VALUE, not inside the substitution.
        # `systemctl is-active` exits 3 for an inactive unit — a true answer with
        # a non-zero status — so `$(systemctl is-active X || echo absent)` ran
        # BOTH: the substitution became "inactive\nabsent" and the report printed
        # a headless `absent (restarts: 0)` line beneath the real one. Every
        # report all evening carried it, on the box and in CI, and a unit line
        # nobody can identify is the worst thing this file can print.
        state=$(systemctl is-active ${unit} 2>/dev/null) || true
        restarts=$(systemctl show ${unit} -p NRestarts --value 2>/dev/null) || true
        echo "${unit}: ''${state:-absent} (restarts: ''${restarts:-n/a})"
      '') cfg.health.watchUnits}
      tsstate=$(systemctl is-active tailscaled 2>/dev/null) || true
      echo "tailscale: ''${tsstate:-absent}"
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
      ${lib.optionalString (cfg.tailscale.enable && cfg.health.publicTlsPort != null) ''
        # Is the tailnet name actually served a certificate a browser trusts?
        #
        # This is the one failure on this box that looks like a bug and is a
        # setting. Tailscale issues certificates only when HTTPS Certificates
        # are enabled for the tailnet, which is OFF by default; without them
        # `get_certificate tailscale` returns nothing and the proxy falls back
        # to its internal CA, correctly and silently. What the owner sees is a
        # warning on the URL that was supposed to be the clean one, and nothing
        # anywhere connects that to a checkbox they have never seen.
        #
        # Matched on the internal CA rather than on a list of public issuers: a
        # box serving Caddy's own certificate for its tailnet name is the
        # symptom, and enumerating acceptable CAs would go stale the day
        # Tailscale changes one.
        name=$(printf '%s' "$status" | jq -r '.Self.DNSName // ""' | sed 's/\.$//')
        if [ -z "$name" ]; then
          echo "tailnet-cert: not enrolled"
        else
          issuer=$(timeout 10 openssl s_client -connect 127.0.0.1:${toString cfg.health.publicTlsPort} \
            -servername "$name" </dev/null 2>/dev/null \
            | timeout 5 openssl x509 -noout -issuer 2>/dev/null || true)
          case "$issuer" in
            *"Caddy Local Authority"*)
              echo "tailnet-cert: INTERNAL — browsers will warn on https://$name"
              echo "             Enable HTTPS Certificates for this tailnet:"
              echo "             https://login.tailscale.com/admin/dns  then: systemctl restart caddy"
              ;;
            "") echo "tailnet-cert: no certificate served on port ${toString cfg.health.publicTlsPort}" ;;
            *) echo "tailnet-cert: public (''${issuer#issuer=})" ;;
          esac
        fi
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
  appliance.health.package = report;

  environment.systemPackages = [ report ];

  # What the box looks like, on the way in.
  #
  # A Tailscale SSH session drops you at a bare prompt on a machine you may not
  # have touched in months: no version, no inverter, no idea whether anything is
  # wrong. The one thing worth printing is the report this module already
  # builds — so this is a placement decision, not a second status surface, and
  # there is nothing here that can disagree with the daily beacon.
  #
  # `interactiveShellInit`, not `users.motd`: the motd is a static file in the
  # store and every useful fact here is discovered at runtime.
  programs.bash.interactiveShellInit = lib.mkIf cfg.health.loginBanner ''
    # Once per session, and only where someone is looking.
    #
    # The exported flag is what makes it once: a subshell inherits it, so a
    # script that spawns shells does not redraw the banner. `ssh box 'cmd'` runs
    # a NON-interactive bash, which never sources this file at all.
    #
    # There used to be a `SHLVL = 1` test alongside these, and it was one
    # constraint too many: an interactive shell is at SHLVL 2 whenever anything
    # wrapped it — tmux, screen, `script`, a nested login — so the banner
    # silently did not appear. Caught by the boot probe, which reaches an
    # interactive shell through a pty and is therefore nested by construction.
    if [ -z "''${SUNREYE_BANNER_SHOWN:-}" ] && [ -t 1 ]; then
      export SUNREYE_BANNER_SHOWN=1
      ${lib.optionalString (cfg.health.bannerHeader != "")
        ''cat ${pkgs.writeText "appliance-banner-header" cfg.health.bannerHeader}''}
      ${lib.getExe report} 2>/dev/null || true
      echo
      echo "sunreye show   — this box's configuration"
      echo "sunreye --help — change it"
      echo
    fi
  '';

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
