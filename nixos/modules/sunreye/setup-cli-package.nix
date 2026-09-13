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
  src = ../../../apps/appliance-cli/src;

  # The CLI's one runtime dependency, vendored.
  #
  # `src` is the source DIRECTORY, and copying it into the store does not bring
  # the workspace's node_modules with it — so the appliance shipped a tool that
  # threw `Cannot find package 'zod'` at its first import, on every subcommand.
  # The sandbox has no network and `bun install` is therefore not available at
  # build time, so the dependency arrives the way Nix fetches anything: pinned,
  # hashed, and checked.
  #
  # The version is asserted against the workspace's own resolution by
  # scripts/appliance-zod-pin.test.ts — a pin in a second place is a pin that
  # drifts.
  zodVersion = "4.4.3";
  zod = pkgs.fetchurl {
    url = "https://registry.npmjs.org/zod/-/zod-${zodVersion}.tgz";
    hash = "sha256-7jjxf1M/1QBhBoWkg64vQTwm9OszpRaEMUVjyNYPJ5w=";
  };

  # Sources and dependency in one tree, because bun resolves `zod` by walking up
  # from the importing file: node_modules has to sit beside main.ts, not in an
  # environment variable that a systemd unit may not carry.
  tree = pkgs.runCommand "sunreye-setup-tree" { } ''
    mkdir -p "$out/node_modules/zod"
    cp -r ${src}/. "$out/"
    tar -xzf ${zod} --strip-components=1 -C "$out/node_modules/zod"
  '';
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
