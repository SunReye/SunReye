# `sunreye-setup` on the box.
#
# Wrapped, not compiled. `bun build --compile` downloads the target runtime at
# build time, which the Nix sandbox forbids — so a compiled binary would need a
# fixed-output derivation around a downloader that also has to agree with the
# lockfile. Running the TypeScript directly under `pkgs.bun` costs ~90 MB of
# closure and no build step at all, and the CLI updates with every
# `nixos-rebuild` because its sources are part of the flake.
#
# The sources live in the monorepo (`apps/appliance-cli/src`) rather than here so
# that `scripts/require-tests.ts` sees them as source: a behaviour change in the
# tool that reconfigures an unreachable box cannot land without a test.
{ config, lib, pkgs, ... }:
let
  cfg = config.appliance.sunreye;
  src = ../../../apps/appliance-cli/src;

  cli = pkgs.writeShellApplication {
    name = "sunreye-setup";
    runtimeInputs = with pkgs; [
      bun
      nixos-rebuild
      git
      # `show` reads the tailnet status, and `tailscale reset` is most of what the
      # command does.
      tailscale
      systemd
      coreutils
    ];
    text = ''
      # --no-install: the CLI has no runtime dependencies beyond zod, which is
      # already in the store copy of the sources. Left on, bun would try to reach
      # the network from a unit on a box whose whole point is working without it.
      exec bun run --no-install ${src}/main.ts "$@"
    '';
  };
in
lib.mkIf (config.appliance.enable && cfg.enable) {
  environment.systemPackages = [ cli ];
}
