# Disk layout.
#
# origin: nixos-sh-appliance@2f444121c544.
#
# Mirrors exactly what nixos-generators' raw-efi format produces, so that
# `nixosConfigurations.appliance` (used for nixos-rebuild against a live unit) and
# `packages.image` (used to flash a new one) describe the same machine. Everything
# is mkDefault so the generator's own definitions win when building an image.
{ lib, ... }:
{
  fileSystems."/" = {
    device = lib.mkDefault "/dev/disk/by-label/nixos";
    fsType = lib.mkDefault "ext4";
    autoResize = true;
    options = [ "noatime" ];
  };

  fileSystems."/boot" = {
    device = lib.mkDefault "/dev/disk/by-label/ESP";
    fsType = lib.mkDefault "vfat";
    options = [ "noatime" "umask=0077" ];
  };

  # Same bootloader the raw-efi format installs. efiInstallAsRemovable writes
  # \EFI\BOOT\BOOTX64.EFI, which is what makes a flashed image boot on a machine
  # whose NVRAM has never heard of it — the normal case for a freshly imaged unit.
  boot.loader.grub = {
    enable = lib.mkDefault true;
    device = lib.mkDefault "nodev";
    efiSupport = lib.mkDefault true;
    efiInstallAsRemovable = lib.mkDefault true;
    configurationLimit = lib.mkDefault 10;
  };

  swapDevices = [ ];

  # A single root filling the disk is what raw-efi gives us, so the workload's
  # state and the host share one filesystem. The disk-guard in storage.nix and the
  # ballast reserve exist because of that: nothing structurally prevents the
  # workload from starving the host, so it is enforced in software.
  #
  # If you move to a partitioned layout, give /var/lib/sunreye its own volume and
  # both of those become belt-and-braces rather than the only defence.
}
