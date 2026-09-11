# SunReye appliance

A flashable NixOS image for an x86-64 mini PC. Write it to an SSD, plug in Ethernet and
power, and the box runs SunReye against the inverter with no host OS to maintain.

**User documentation lives in the docs site** — hardware, flashing, first boot, sharing the
box, updates: `apps/docs/src/content/docs/deploy/appliance.md`. This file is for working on
the image itself.

## Layout

```
flake.nix              lib.mkAppliance, nixosModules.{appliance,sunreye}, packages.{image,vmTest}, checks
modules/appliance/     the generic base: boot, hardware, watchdog, identity, network,
                       ssh, tailscale, storage, ballast, health, updates.
                       Knows nothing about SunReye.
modules/sunreye/       the workload: two podman containers, Caddy, first-boot seeding,
                       backups, and the sunreye-setup wrapper.
template/              what /etc/nixos becomes on first boot. The image is built from
                       these same files, so the box and the image are one evaluation.
tests/                 the boot report CI greps, and the refusals asserted as a check.
version.json           the server image tag. Advanced by CI after the images publish.
```

`modules/appliance/` came from `nixos-sh-appliance@2f444121c544`, which solved the appliance
problems (eMMC and NIC firmware, hardware watchdog, panic recovery, per-unit identity,
Tailscale enrolment and 4via6 routing, storage hygiene, the ballast reserve, the health
beacon) against a Home Assistant OS guest. The HAOS-specific modules are gone; each file
carries an `origin:` line and, where a decision changed, why. That repo is archived.

## Working on it

```bash
nix flake check ./nixos        # evaluate, and prove the refusals still refuse. No KVM.
nix build ./nixos#image        # the flashable artifact (~3 GB closure)
nix build ./nixos#vmTest       # the boot test
./result/bin/run-*-vm -display none -serial mon:stdio -no-reboot   # needs KVM
```

`nix flake check` is the gate that runs on every PR touching `nixos/**`; the boot test runs
there too, on a runner with KVM. `tests/assertions.nix` is the reason a deleted assertion
goes red: `checks.eval` only proves a *good* configuration builds, and every assertion in
these modules exists because some option combination produces a box that looks configured
and does not work.

## Two things that will bite

**The OCI images are pinned by digest AND by a fixed-output hash, together.** Bumping one
alone fails the build with a hash mismatch. Get both from:

```bash
nix run nixpkgs#nix-prefetch-docker -- \
  --image-name ghcr.io/sunreye/sunreye-server \
  --image-digest sha256:… --final-image-tag X.Y.Z --arch amd64 --os linux
```

The release workflow does this for the server image automatically. The database image moves
only when `docker/timescaledb/Dockerfile` does — `scripts/storage-tuning.ts` asserts that
`modules/sunreye/images.nix` names the same tag as every other deployment surface.

**`sunreye-setup` is not in this directory.** Its source is `apps/appliance-cli/src`, so the
repo's TDD gate treats it as source; `modules/sunreye/setup-cli.nix` wraps it with
`pkgs.bun`. It is not compiled because `bun build --compile` downloads the target runtime at
build time, which the Nix sandbox forbids.

## What is deliberately not here

arm64. Wi-Fi. Secure boot. Disk encryption. A settings tab in the dashboard for any of
this — the option surface has to prove itself through the CLI first.
