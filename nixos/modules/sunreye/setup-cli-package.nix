# `sunreye-setup` on the box, as a package.
#
# A package rather than an inline derivation inside the module so the flake can
# BUILD AND RUN it (`checks.setup-cli`) without evaluating a whole NixOS system.
# The tool that reconfigures a box nobody can physically reach had no check that
# it starts at all: the boot test was the first thing to run it, twenty minutes
# in, and it had been failing at its first import.
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
{ pkgs }:
let
  # Sources and vendored dependency in one tree. Shared with ./first-boot.nix,
  # which runs a different entry point out of the same directory — two copies
  # would be two zod pins.
  tree = import ./cli-tree.nix { inherit pkgs; };
in
pkgs.writeShellApplication {
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
    # --no-install: bun must never reach the network from a unit on a box whose
    # whole point is working without it.
    exec bun run --no-install ${tree}/main.ts "$@"
  '';
}
