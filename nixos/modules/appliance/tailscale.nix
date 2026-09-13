# Tailscale enrolment and optional site-LAN routing.
#
# origin: nixos-sh-appliance@2f444121c544. Three changes, all consequences of
# publishing the image instead of flashing a fleet:
#
#  1. `authKeyFile` is optional. A published image carries no key — there is no
#     key that could be in it that would be safe, and a key in the store is
#     world-readable and identical on every unit built from the same flake.
#  2. When there is no key, `tailscale web` is served on the LAN so whoever
#     plugged the box in enrols it into THEIR tailnet from a browser. The window
#     closes itself the moment login succeeds and nothing reopens it. This is
#     what makes the image safe to publish: a stranger's enrolment of their own
#     box grants its builder nothing.
#  3. The tag assertion is gone. A user-owned node cannot advertise tags, so
#     `--advertise-tags` is omitted rather than passed empty, and tags are only
#     required to be sane when a key is actually set.
{ config, lib, pkgs, ... }:
let
  cfg = config.appliance;
  ts = cfg.tailscale;
  lan = ts.lan;
  web = ts.webLogin;

  routing = lan.mode != "none";
  wantsDirect = lan.mode == "direct" || lan.mode == "both";
  wantsVia = lan.mode == "via" || lan.mode == "both";
  keyed = ts.authKeyFile != null;
in
lib.mkIf (cfg.enable && ts.enable) {
  assertions = [
    {
      assertion = keyed || web.enable;
      message = ''
        appliance.tailscale.authKeyFile is null and
        appliance.tailscale.webLogin.enable is false, so this unit has no way to
        enrol at all: no key to use unattended, and no login window to use by
        hand. Set one of the two, or disable appliance.tailscale.
      '';
    }
    {
      assertion = !keyed || ts.tags != [ ];
      message = ''
        appliance.tailscale.authKeyFile is set but appliance.tailscale.tags is
        empty. An unattended enrolment is a fleet enrolment, and autoApprovers
        matches on the tag — an untagged node's routes are never approved, so
        enrolment appears to succeed while nothing behind the box is reachable.
      '';
    }
    {
      assertion = !wantsVia || lan.siteId != null;
      message = ''
        appliance.tailscale.lan.mode = "${lan.mode}" requires
        appliance.tailscale.lan.siteId. Assign a unique integer per site — reusing
        one recreates exactly the collision 4via6 exists to prevent.
      '';
    }
    {
      assertion = lan.siteId == null || wantsVia;
      message = ''
        appliance.tailscale.lan.siteId is set but mode = "${lan.mode}" never uses it.
        Set mode to "via" or "both", or drop the siteId.
      '';
    }
  ];

  warnings =
    lib.optional (lan.mode == "direct") ''
      appliance.tailscale.lan.mode = "direct" advertises the site LAN prefix as-is.
      That is fine for one site, which is the common case for an owner with their
      own tailnet — and it is the reason this is a warning and not an error.

      It does not survive a second site. Tailscale performs failover, not per-site
      routing, for identical prefixes, and essentially every home LAN is
      192.168.0.0/24 or 192.168.1.0/24, so a second box would make this one
      unreachable non-deterministically. If you expect one, use mode = "both" now:
      you keep direct addressing today and this site's 4via6 address already works.
    '';

  services.tailscale = {
    enable = true;
    authKeyFile = ts.authKeyFile;
    # "server" also applies the rx-udp-gro-forwarding ethtool tuning Tailscale warns
    # about on subnet routers, and enables IPv6 forwarding — both of which a
    # hand-rolled `sysctl net.ipv4.ip_forward=1` misses.
    useRoutingFeatures = if routing then "server" else "client";
    authKeyParameters.preauthorized = keyed;
    extraUpFlags =
      [ "--ssh" ]
      ++ lib.optional (ts.tags != [ ]) "--advertise-tags=${lib.concatStringsSep "," ts.tags}"
      ++ lib.optional (!ts.acceptRoutes) "--accept-routes=false"
      ++ lib.optional ts.acceptRoutes "--accept-routes";
  };

  # `tailscale web` in login mode: the box serves its own enrolment page on the
  # LAN, so a first boot needs a browser and nothing else — no console, no key,
  # no account belonging to whoever built the image.
  #
  # Self-limiting in two directions, deliberately. ExecStartPre refuses to start
  # the listener once the backend is Running, so a reboot of an enrolled box does
  # not reopen a login page on its LAN; and the timer below stops the unit as
  # soon as login succeeds, so the window is open for minutes on a first boot,
  # not forever. Re-enrolment is an explicit root action
  # (`sunreye-setup tailscale reset`), never something the box decides.
  systemd.services.tailscale-web = lib.mkIf web.enable {
    description = "Tailscale login page for first enrolment (LAN only)";
    after = [ "tailscaled.service" "network-online.target" ];
    wants = [ "network-online.target" ];
    requires = [ "tailscaled.service" ];
    wantedBy = [ "multi-user.target" ];
    path = with pkgs; [ tailscale jq ];
    serviceConfig = {
      Type = "exec";
      Restart = "on-failure";
      RestartSec = "10s";
      # ExecCondition, not ExecStartPre. A non-zero ExecStartPre FAILS the unit,
      # which with Restart=on-failure would crash-loop an already-enrolled box
      # and then show up in the health report as a failed unit — pages about a
      # machine that is working exactly as intended. A failed ExecCondition
      # instead skips the start and leaves the unit inactive/dead, which is the
      # honest state for "the login window is not needed".
      ExecCondition = pkgs.writeShellScript "tailscale-web-guard" ''
        set -euo pipefail
        state=$(tailscale status --json 2>/dev/null | jq -r '.BackendState // "NoState"')
        if [ "$state" = "Running" ]; then
          echo "already enrolled (BackendState=Running); not opening a login page"
          exit 1
        fi
        echo "not enrolled (BackendState=$state); opening the login page on port ${toString web.port}"
      '';
      ExecStart = "${lib.getExe pkgs.tailscale} web --listen 0.0.0.0:${toString web.port}";
    };
    unitConfig = {
      StartLimitBurst = 5;
      StartLimitIntervalSec = "5min";
    };
  };

  # Polls for the transition to Running and stops the listener. A path unit
  # cannot do this: tailscaled's state is in a sqlite-ish state file whose writes
  # are not a reliable edge, and `BackendState` is the fact we actually care
  # about. One systemctl call a minute during the first boot window, and the
  # timer stops firing usefully the moment the service is gone.
  systemd.services.tailscale-web-close = lib.mkIf web.enable {
    description = "Close the Tailscale login window once enrolment succeeds";
    path = with pkgs; [ tailscale jq systemd ];
    serviceConfig.Type = "oneshot";
    script = ''
      set -euo pipefail
      systemctl is-active --quiet tailscale-web || exit 0
      state=$(tailscale status --json 2>/dev/null | jq -r '.BackendState // "NoState"')
      if [ "$state" = "Running" ]; then
        echo "enrolled; stopping the login page"
        systemctl stop tailscale-web
      fi
    '';
  };

  systemd.timers.tailscale-web-close = lib.mkIf web.enable {
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnBootSec = "1min";
      OnUnitActiveSec = "1min";
      AccuracySec = "10s";
    };
  };

  # The listener is only up while enrolment is pending, so the open port is not
  # an always-on surface. Opening it unconditionally rather than rewriting
  # firewall rules from a unit keeps one source of truth for the ruleset: a
  # dynamic rule that fails to be removed is a worse outcome than a port nothing
  # is listening on.
  networking.firewall.allowedTCPPorts = lib.mkIf web.enable [ web.port ];

  # Forwarding between the tailnet and the site LAN.
  #
  # With the default iptables backend and filterForward = false, the FORWARD policy
  # is ACCEPT and tailscaled installs its own rules, so this is a no-op. It matters
  # only if someone later turns on nftables + filterForward, at which point silently
  # dropping forwarded traffic would look like a Tailscale bug.
  networking.firewall.extraForwardRules = lib.mkIf (routing && config.networking.firewall.filterForward) ''
    iifname "tailscale0" oifname "${cfg.network.lanInterface}" accept
    iifname "${cfg.network.lanInterface}" oifname "tailscale0" ct state established,related accept
  '';

  systemd.services.appliance-advertise-routes = lib.mkIf routing {
    description = "Advertise site LAN routes to the tailnet";
    after = [ "tailscaled.service" "network-online.target" ];
    wants = [ "network-online.target" ];
    requires = [ "tailscaled.service" ];
    wantedBy = [ "multi-user.target" ];
    # Reconverge if the site's router hands out a different prefix later.
    startAt = "hourly";
    path = with pkgs; [ tailscale jq iproute2 coreutils ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      Restart = "on-failure";
      RestartSec = "15s";
    };
    unitConfig = {
      StartLimitBurst = 10;
      StartLimitIntervalSec = "10min";
    };
    script = ''
      set -euo pipefail
      link=${cfg.network.lanInterface}

      subnet=""
      for _ in $(seq 1 60); do
        # Match the link-scope route against the address actually on the
        # interface, rather than trusting whichever entry happens to be first.
        addr=$(ip -j -4 addr show dev "$link" | jq -r '.[0].addr_info[0].local // empty')
        if [ -n "$addr" ]; then
          subnet=$(ip -j -4 route show dev "$link" scope link \
            | jq -r '[.[] | select(.dst != null and .dst != "default")] | .[0].dst // empty')
        fi
        [ -n "$subnet" ] && break
        sleep 2
      done

      if [ -z "$subnet" ]; then
        echo "no link-scope IPv4 route on $link after 120s; not advertising" >&2
        exit 1
      fi
      case "$subnet" in
        */*) ;;
        *) echo "route '$subnet' carries no prefix length; refusing" >&2; exit 1 ;;
      esac

      prefixes="$subnet${lib.concatMapStrings (r: " ${r}") lan.extraRoutes}"
      routes=""
      add() { routes="''${routes:+$routes,}$1"; }

      for p in $prefixes; do
        ${lib.optionalString wantsDirect ''add "$p"''}
        ${lib.optionalString wantsVia ''add "$(tailscale debug via ${toString lan.siteId} "$p")"''}
      done

      echo "advertising: $routes"
      tailscale set --advertise-routes="$routes"

      # Recorded so `appliance-health-report` can show what this unit claims to
      # route without you having to reconstruct it from the tailnet side, and can
      # diff it against the routes the tailnet actually approved.
      install -d -m 0755 /run/appliance
      printf '%s\n' "$routes" > /run/appliance/routes
      ${lib.optionalString wantsVia ''
        printf 'site-id: %s\n' "${toString lan.siteId}" >> /run/appliance/routes
      ''}
    '';
  };
}
