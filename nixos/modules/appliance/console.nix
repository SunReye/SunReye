# A way in that does not depend on the network.
#
# A published image can carry no credential: a key in it belongs to whoever built
# it, and a default password is the same password on every unit ever flashed —
# one screenshot and every box in the field is open. So the image shipped with
# none, root was locked, and `users.allowNoPasswordLogin = false`: a keyboard on
# the box reached a login prompt that could not be passed. The docs promised
# exactly that keyboard as the fallback.
#
# Measured on a real unit: Tailscale SSH was off (see tailscale.nix),
# `authorized_keys` was empty because a published image has no key, and the
# console could not be logged into. The box was unreachable by every path it
# documents.
#
# The password is therefore GENERATED, per box, on first boot — and shown on the
# console login screen. That is not a leak: the only person who can read it is
# already standing at the keyboard, which is precisely the access it grants.
# Someone with physical access to a box whose disk is not encrypted can read the
# datadir anyway.
#
# It is console-only. `services.openssh.settings.PasswordAuthentication` is
# false, so this password is worthless to anyone who is not in the room.
{ config, lib, pkgs, ... }:
let
  cfg = config.appliance;
  console = cfg.console;
  secretsDir = "/var/lib/secrets";
  passwordFile = "${secretsDir}/console-password";
in
lib.mkIf (cfg.enable && console.password.enable) {
  # agetty reads /etc/issue, and NixOS makes it a symlink into the read-only
  # store — so the greeting cannot name a password that did not exist at build
  # time. Taking the file over is the only way to put a per-box fact on the
  # login screen.
  environment.etc."issue".enable = lib.mkForce false;

  systemd.services.appliance-console-password = {
    description = "Generate this box's console password and put it on the login screen";
    wantedBy = [ "multi-user.target" ];
    # Before any getty shows a prompt, or the first person to look sees a
    # greeting with no password in it and concludes there is none.
    before = [ "getty.target" ];
    after = [ "local-fs.target" ];
    path = with pkgs; [ coreutils openssl shadow ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
    };
    script = ''
      set -euo pipefail

      install -d -m 0700 ${secretsDir}

      # Generated once and kept, so it survives a reboot and a rebuild. A
      # password that changed on every boot would be one nobody could write down.
      if [ ! -s ${passwordFile} ]; then
        echo "generating this box's console password"
        # No ambiguous glyphs: this gets read off a screen and typed on a
        # keyboard whose layout nobody chose, often in a cupboard.
        password=$(openssl rand -base64 24 | tr -dc 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ34679' | cut -c1-14)
        if [ ''${#password} -lt 14 ]; then
          echo "refusing to set a short password" >&2
          exit 1
        fi
        umask 077
        printf '%s\n' "$password" > ${passwordFile}
        chmod 0600 ${passwordFile}
        printf 'root:%s\n' "$password" | chpasswd
      fi

      password=$(cat ${passwordFile})

      # 0644, like the /etc/issue it replaces: agetty reads it before anyone has
      # authenticated, so it cannot be root-only.
      umask 022
      cat > /etc/issue <<EOF
      SunReye appliance — \n

      Log in as root with the password below. It is unique to THIS box and is
      only accepted here, on the console: SSH refuses passwords entirely.

          root / $password

      Set up the box from your browser instead if you can — it is easier:
      the address is printed on the label in your dashboard, or find this
      machine in your router's device list.

      EOF
    '';
  };
}
