# The appliance CLI, bundled to JavaScript and run on node.
#
# NOT bun, and that is the whole point of this file. The bun nixpkgs ships dies
# with SIGILL on a CPU without AVX — including the `-baseline` build it already
# uses — and that is every Atom-class thin client: exactly the cheap mini PCs
# this image exists for. Reproduced under `-cpu Nehalem` against an otherwise
# identical image: `sunreye-setup` and the first-boot password window both
# failed while the dashboard stayed up, because the server ships as a separately
# compiled binary. On a real Futro the symptom was
# `Illegal instruction (core dumped) sunreye-setup help`, and a box whose
# configuration tool cannot start is a box nobody can point at their inverter.
#
# node from nixpkgs is built from source for generic x86-64 and assumes no
# instruction set extension. esbuild does the TypeScript, in the sandbox, with
# no network: it strips types and bundles the one dependency, so nothing is
# resolved at runtime and there is no node_modules to ship.
#
# Two entry points come out of the same tree — `sunreye-setup` and the
# first-boot window — because building it twice would pin zod twice.
{ pkgs }:
let
  src = ../../../apps/appliance-cli/src;

  # The CLI's one runtime dependency, vendored.
  #
  # The sandbox has no network and `bun install` is therefore unavailable at
  # build time, so the dependency arrives the way Nix fetches anything: pinned,
  # hashed, and checked. The version is asserted against the workspace's own
  # resolution by scripts/appliance-zod-pin.test.ts — a pin in a second place is
  # a pin that drifts.
  zodVersion = "4.4.3";
  zod = pkgs.fetchurl {
    url = "https://registry.npmjs.org/zod/-/zod-${zodVersion}.tgz";
    hash = "sha256-7jjxf1M/1QBhBoWkg64vQTwm9OszpRaEMUVjyNYPJ5w=";
  };
in
pkgs.runCommand "sunreye-cli-bundle"
{
  nativeBuildInputs = [ pkgs.esbuild ];
} ''
  set -euo pipefail

  work=$(mktemp -d)
  mkdir -p "$work/node_modules/zod"
  cp -r ${src}/. "$work/"
  tar -xzf ${zod} --strip-components=1 -C "$work/node_modules/zod"

  mkdir -p "$out"
  # --platform=node: picks node's resolution and leaves its built-ins external,
  # which is what makes node:child_process and node:http resolve at runtime.
  # --bundle: zod is inlined, so the store path carries no node_modules and
  # nothing is resolved relative to the CWD of whatever unit invokes it.
  for entry in main first-boot; do
    esbuild "$work/$entry.ts" \
      --bundle \
      --platform=node \
      --format=esm \
      --target=node20 \
      --outfile="$out/$entry.mjs"
  done
''
