# `sunreye` on the box, as a package.
#
# A package rather than an inline derivation inside the module so the flake can
# BUILD AND RUN it (`checks.setup-cli`) without evaluating a whole NixOS system.
# The tool that reconfigures a box nobody can physically reach had no check that
# it starts at all: the boot test was the first thing to run it, twenty minutes
# in, and it had been failing at its first import.
#
# Bundled with esbuild and run on node — NOT bun, and not compiled.
#
# bun ran the TypeScript directly, which cost no build step at all and was wrong
# on the hardware this image is for: the bun nixpkgs ships faults with SIGILL on
# a CPU without AVX, including its `-baseline` build, and that is every
# Atom-class thin client. On a flashed Futro the symptom was
# `Illegal instruction (core dumped) sunreye-setup help` — a box whose
# configuration tool cannot start. See ./cli-tree.nix.
#
# Not `bun build --compile` either: it downloads the target runtime at build
# time, which the Nix sandbox forbids. esbuild strips types and inlines the one
# dependency in the sandbox with no network, and node from nixpkgs is built from
# source and assumes no instruction set extension.
#
# The sources live in the monorepo (`apps/appliance-cli/src`) rather than here so
# that `scripts/require-tests.ts` sees them as source: a behaviour change in the
# tool that reconfigures an unreachable box cannot land without a test.
{ pkgs }:
let
  # The bundled CLI. Shared with ./first-boot.nix, which runs the other entry
  # point out of the same bundle — two builds would be two zod pins.
  bundle = import ./cli-tree.nix { inherit pkgs; };

  app = pkgs.writeShellApplication {
    name = "sunreye";
    runtimeInputs = with pkgs; [
      # node, NOT bun: the bun nixpkgs ships faults with SIGILL on a CPU without
      # AVX, which is every Atom-class thin client this image targets. See
      # ./cli-tree.nix.
      nodejs
      nixos-rebuild
      git
      # `show` reads the tailnet status, and `tailscale reset` is most of what
      # the command does.
      tailscale
      systemd
      coreutils
    ];
    text = ''
      exec node ${bundle}/main.mjs "$@"
    '';
  };
in
# `sr` and `sunreye-setup` are the same program, as SYMLINKS rather than shell
# aliases: an alias exists only in an interactive shell, so `ssh box
# sunreye-setup show` — which is how a script, or a half-remembered command,
# arrives — would answer "command not found".
#
# `sunreye-setup` is kept because it is printed on the console login screen of
# every box already flashed, in the login banner, in the docs and in people's
# shell history. A rename that breaks all of those to save seven characters
# costs more than it saves.
pkgs.runCommand "sunreye-cli" { } ''
  mkdir -p "$out/bin"
  for name in sunreye sr sunreye-setup; do
    ln -s ${app}/bin/sunreye "$out/bin/$name"
  done
''
