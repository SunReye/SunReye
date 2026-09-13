# The two OCI images the appliance runs, baked into the Nix store.
#
# Why OCI images and not native Nix packages, decided once and not relitigated:
#
#   • `bun build --compile` downloads the target runtime at build time, which the
#     Nix sandbox forbids. Packaging the server natively therefore means either a
#     fixed-output derivation around a downloader (fragile, and it still has to
#     match the lockfile) or giving up the compiled binary the other two
#     deployment channels ship.
#   • nixpkgs' timescaledb and timescaledb_toolkit do not match the 2.28.2 pin
#     that `scripts/storage-tuning.ts` asserts across every surface. Running a
#     different extension build here would recreate exactly the split that gate
#     exists to prevent: a migration that passes in dev and fails on the box.
#
# So the appliance runs the SAME images as docker compose. `dockerTools.pullImage`
# is a fixed-output derivation, so it works inside the sandbox, and the result is
# loaded through `imageFile` — the image is in the store before the box ever
# boots, so a first boot on a site with no working DNS still comes up.
#
# Bumping these: the digest and the FOD `sha256` are a pair and both change
# together. `nix run nixpkgs#nix-prefetch-docker -- --image-name <name>
# --image-digest <digest> --final-image-tag <tag> --arch amd64 --os linux` prints
# both. The release workflow (.github/workflows/nixos-image.yml) does this
# automatically for the server image when a `server-v*` tag publishes.
{ pkgs, lib, version }:
let
  # Named so `scripts/storage-tuning.ts` can see it: every surface that starts a
  # database must name the one image, or dev/CI and a deployment carry different
  # extensions and a migration passes on one side only. This file is one of those
  # surfaces — see DB_IMAGE_SURFACES.
  image = "ghcr.io/sunreye/timescaledb:pg17-ts2.28.2";

  split = ref: {
    name = lib.head (lib.splitString ":" ref);
    tag = lib.last (lib.splitString ":" ref);
  };
  db = split image;
in
{
  # The tag is a deliberate pin, not a moving label: the datadir under the bind
  # mount is only compatible with the pg major that created it, and the extension
  # binary must be at least the version stamped in the database. It moves only
  # when docker/timescaledb/Dockerfile does.
  #
  # A future TimescaleDB bump needs an `ALTER EXTENSION timescaledb UPDATE` run
  # against the live database. Neither compose nor this module does that today;
  # it is a transition-release concern and deliberately out of scope here.
  timescaledb = pkgs.dockerTools.pullImage {
    imageName = db.name;
    imageDigest = "sha256:01d74b5dc0b1b576b0b22e9488237f78bc05c29aa6fc669c327a91602534fdc5";
    hash = "sha256-RbAEtW3ifkNpAkokBn2Y32pTG2bGS+NH4TyXWZP4D5g=";
    finalImageName = db.name;
    finalImageTag = db.tag;
    os = "linux";
    arch = "amd64";
  };

  server = pkgs.dockerTools.pullImage {
    imageName = "ghcr.io/sunreye/sunreye-server";
    imageDigest = "sha256:e6c11adbb5c9458a145d59ab628f7fb5b238677fb599d465a4b5cf3dee5eee99";
    hash = "sha256-rrT6C7+z+ytyHaVIzbWer3gpCTDzVTDtO+m4OZlQTiY=";
    finalImageName = "ghcr.io/sunreye/sunreye-server";
    finalImageTag = version;
    os = "linux";
    arch = "amd64";
  };

  # Re-exported so the container definitions name the image the gate checks
  # rather than reconstructing the string.
  databaseImage = image;
}
