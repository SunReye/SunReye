# The appliance CLI's sources, with its one dependency beside them.
#
# Extracted because two entry points run out of this directory — `sunreye-setup`
# (./setup-cli-package.nix) and the first-boot password window
# (./first-boot.nix) — and building the tree twice would mean pinning zod twice.
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
in
# bun resolves `zod` by walking up from the importing file: node_modules has to
# sit beside main.ts, not in an environment variable a systemd unit may not carry.
pkgs.runCommand "sunreye-cli-tree" { } ''
  mkdir -p "$out/node_modules/zod"
  cp -r ${src}/. "$out/"
  tar -xzf ${zod} --strip-components=1 -C "$out/node_modules/zod"
''
