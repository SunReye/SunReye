# The first-boot password window.
#
# `appliance/console.nix` generates this box's root password and prints it on
# the login screen. That covers someone at the machine with a monitor and nobody
# else — and an appliance's normal home is a cupboard. Tailscale SSH needs
# enrolment to have already worked, and a baked `authorized_keys` needs the
# owner to have built the image. So the password is also served to a browser on
# the LAN, once, for a few minutes after boot.
#
# Behind the dashboard's own Caddy rather than on a port of its own: one
# listener, one firewall rule, one certificate path — and once the box is
# enrolled it is a real publicly-trusted certificate with no special case. On a
# first boot it is the internal CA, so the browser warns; that encrypts the
# password against passive sniffing on the LAN without authenticating the box,
# which is an improvement and not a complete one.
#
# Lives here rather than in modules/appliance because it needs the CLI tree and
# the reverse proxy, both of which are this layer's.
{ config, lib, pkgs, ... }:
let
  appliance = config.appliance;
  password = appliance.console.password;
  web = password.web;
  bundle = import ./cli-tree.nix { inherit pkgs; };
in
lib.mkIf (appliance.enable && password.enable && web.enable) {
  systemd.services.appliance-first-boot = {
    description = "Hand this box's console password to a browser on the LAN, once";
    wantedBy = [ "multi-user.target" ];
    # After the password exists, or the first person to look gets "still
    # starting up" and has burned part of their window on nothing.
    after = [ "appliance-console-password.service" "network.target" ];
    wants = [ "appliance-console-password.service" ];
    path = [ pkgs.nodejs ];
    serviceConfig = {
      Type = "exec";
      # NOT RuntimeMaxSec. Killing the process at the deadline is what turned a
      # closed window into a 502: Caddy had nothing behind the route and the
      # owner got a bare gateway error instead of being told what happened —
      # which destroys the one property this whole design exists for. Whether
      # you were beaten to the password or simply arrived late is the thing you
      # need to know, and a 502 says neither.
      #
      # The server enforces both closures itself (first read, then the
      # deadline), so the process staying up costs a loopback listener that
      # answers 410 and hands out nothing.
      Restart = "on-failure";
      RestartSec = "10s";
      DynamicUser = false;
      # It reads a 0600 file owned by root and writes the marker beside it.
      User = "root";
    };
    # Refuses to start on a box whose password has already been handed out, so a
    # reboot does not reopen the window. ExecCondition rather than a failing
    # ExecStartPre: a failed condition leaves the unit inactive, which is the
    # honest state for "not needed", where a failure would be a lie.
    serviceConfig.ExecCondition = pkgs.writeShellScript "first-boot-guard" ''
      if [ -e ${password.claimFile} ]; then
        echo "password already handed out; not reopening the window"
        exit 1
      fi
      echo "password not yet handed out; opening the window for ${toString web.openFor} minutes"
    '';
    environment = {
      SUNREYE_PASSWORD_FILE = toString password.file;
      SUNREYE_CLAIM_FILE = toString password.claimFile;
      SUNREYE_FIRST_BOOT_PORT = toString web.port;
      SUNREYE_FIRST_BOOT_WINDOW_MS = toString (web.openFor * 60 * 1000);
    };
    script = "exec node ${bundle}/first-boot.mjs";
  };
}
