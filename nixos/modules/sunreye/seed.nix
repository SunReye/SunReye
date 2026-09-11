# First-boot provisioning: the box's own config tree, and the secrets that must
# not be in a published image.
#
# The image is built from `nixos/template/` with the flake input overridden to
# this repo, and on first boot it copies that same template to `/etc/nixos`. So
# the image and the live box evaluate the same expression — which is what makes
# `sunreye-setup apply` a safe thing to run on a machine nobody can reach: the
# rebuild is against a tree whose shape was already proven at image build time.
{ config, lib, pkgs, ... }:
let
  cfg = config.appliance.sunreye;
  stateDir = "/var/lib/sunreye";
  secretsEnv = "${stateDir}/secrets.env";
  template = ../../template;
in
lib.mkIf (config.appliance.enable && cfg.enable) {
  systemd.services.appliance-seed = {
    description = "Seed /etc/nixos and the appliance's generated secrets";
    wantedBy = [ "multi-user.target" ];
    # Before the database, because it generates the password the database is
    # created with; and before tailscaled, because the optional fleet path below
    # is what puts an auth key where tailscaled expects one.
    before = [ "podman-sunreye-postgres.service" "tailscaled.service" ];
    after = [ "local-fs.target" ];
    path = with pkgs; [ coreutils git openssl ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
    };
    script = ''
      set -euo pipefail

      # ── /etc/nixos ──────────────────────────────────────────────────────────
      # Only ever seeded, never updated: after the first boot this tree is the
      # owner's, and `sunreye-setup` commits to it. Overwriting it on a later
      # boot would silently discard their local.nix.
      if [ ! -e /etc/nixos/flake.nix ]; then
        echo "seeding /etc/nixos from the image's own template"
        install -d -m 0755 /etc/nixos
        cp -r --no-preserve=mode,ownership ${template}/. /etc/nixos/
        chmod 0644 /etc/nixos/*
        # A git repo, because `nixos-rebuild --flake /etc/nixos` ignores files git
        # does not know about: an untracked site.json is invisible to the
        # evaluation, which presents as "the setting I just changed did nothing".
        # It also gives the owner a way back from a bad edit.
        if [ ! -d /etc/nixos/.git ]; then
          git -C /etc/nixos init -q -b main
          git -C /etc/nixos -c user.name=appliance -c user.email=appliance@localhost \
            -c commit.gpgsign=false add -A
          git -C /etc/nixos -c user.name=appliance -c user.email=appliance@localhost \
            -c commit.gpgsign=false commit -q -m "seed: image defaults"
        fi
      fi

      # ── secrets ─────────────────────────────────────────────────────────────
      # Generated here, not baked. A secret in the image is the same secret on
      # every box flashed from it, and the image is published.
      install -d -m 0750 ${stateDir}
      if [ ! -s ${secretsEnv} ]; then
        echo "generating this box's auth secret and database password"
        auth=$(openssl rand -base64 48)
        pgpw=$(openssl rand -hex 24)
        umask 077
        cat > ${secretsEnv} <<EOF
      BETTER_AUTH_SECRET=$auth
      POSTGRES_PASSWORD=$pgpw
      DATABASE_URL=postgresql://postgres:$pgpw@127.0.0.1:5432/SunReye
      EOF
        chmod 0600 ${secretsEnv}
      fi

      # ── optional fleet path ─────────────────────────────────────────────────
      # A flasher can drop files onto the ESP before first boot: an auth key for
      # unattended enrolment, and a site.nix for a unit that is being prepared
      # for a known site. Neither is required, and the published image never has
      # them. Sources are shredded, because /boot is a vfat partition anyone who
      # picks the box up can read.
      if [ -d /boot/appliance-seed ]; then
        if [ -s /boot/appliance-seed/tailscale-authkey ]; then
          install -d -m 0700 /var/lib/secrets
          install -m 0600 /boot/appliance-seed/tailscale-authkey /var/lib/secrets/tailscale-authkey
          shred -u /boot/appliance-seed/tailscale-authkey
          echo "took delivery of a tailscale auth key from /boot"
        fi
        for f in site.nix site.json local.nix; do
          if [ -s "/boot/appliance-seed/$f" ]; then
            install -m 0644 "/boot/appliance-seed/$f" "/etc/nixos/$f"
            shred -u "/boot/appliance-seed/$f"
            echo "took delivery of $f from /boot"
          fi
        done
        rmdir /boot/appliance-seed 2>/dev/null || true
      fi
    '';
  };

  # Nightly, from the box's own flake, bumping the one input that points at this
  # repo's `stable` branch. `stable` is fast-forwarded only after the container
  # images for that version are in GHCR, so a box can never pull a config whose
  # image tag does not exist — which on an appliance means a dashboard that
  # vanishes overnight with a podman pull error nobody will read.
  appliance.autoUpgrade = {
    enable = lib.mkDefault true;
    flake = lib.mkDefault "/etc/nixos";
    flags = lib.mkDefault [ "--update-input" "sunreye" "--commit-lock-file" ];
  };
}
