# The generic appliance base: everything that is true of a headless box flashed
# onto an unknown mini PC and left in someone else's house, and nothing about
# what it runs.
#
# origin: nixos-sh-appliance@2f444121c544, minus `haos-vm.nix`, `haos-image.nix`
# and `backup.nix` (the KVM guest and snapshots of its disk). The workload lives
# in a sibling module — see ../sunreye — and reaches this layer through
# `appliance.health.watchUnits` and `appliance.network.bridge` rather than by
# being named here.
{ ... }:
{
  imports = [
    ./options.nix
    ./boot.nix
    ./filesystems.nix
    ./hardware.nix
    ./storage.nix
    ./ballast.nix
    ./watchdog.nix
    ./network.nix
    ./identity.nix
    ./ssh.nix
    ./tailscale.nix
    ./health.nix
    ./update.nix
  ];
}
