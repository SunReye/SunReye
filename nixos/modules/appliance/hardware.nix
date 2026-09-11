# Hardware enablement for an image flashed to an unknown mini PC.
#
# origin: nixos-sh-appliance@2f444121c544 (unchanged).
#
# Verified against nixpkgs/nixos-26.05 + nixos-generators raw-efi: the generator
# contributes exactly one initrd module (`uas`), and neither `all-hardware` nor
# `enableRedistributableFirmware` appears anywhere in nixos-generators. NixOS's own
# defaults cover NVMe and SATA, so the two real gaps are eMMC and NIC firmware.
{ config, lib, pkgs, modulesPath, ... }:
let
  cfg = config.appliance;
in
{
  # Broad driver coverage. Deliberately NOT profiles/qemu-guest.nix — that
  # configures NixOS *as* a guest and contributes only dead virtio weight here.
  # `imports` cannot be conditional, so it sits outside the mkIf.
  imports = [ "${modulesPath}/profiles/all-hardware.nix" ];

  config = lib.mkIf cfg.enable {
  boot.initrd.availableKernelModules = [
    # eMMC. `mmc_block` is the block layer and is already in the default set, but
    # the SDHCI *host controller* driver is what talks to the device — verified
    # absent from the raw-efi image. Without these an eMMC stick hangs in initrd
    # while the NVMe SKUs boot fine, which is the failure mode that costs a day.
    "sdhci_pci"
    "sdhci_acpi"
    "sdhci"
    "mmc_block"
    # Explicit rather than inherited, so a nixpkgs default change is visible here.
    "nvme"
    "ahci"
    "xhci_pci"
    "usbhid"
    "usb_storage"
    "sd_mod"
  ];

  # Realtek r8169 variants need rtl_nic/*.fw and are the common NIC on these
  # sticks. No firmware, no NIC — and on a headless appliance, no recovery path.
  hardware.enableRedistributableFirmware = true;

  # Both vendors: hardcoding kvm-intel silently bricks every AMD SKU, and
  # Restart=always then turns that into a boot loop.
  hardware.cpu.intel.updateMicrocode = lib.mkDefault true;
  hardware.cpu.amd.updateMicrocode = lib.mkDefault true;
  boot.kernelModules = [ "kvm-intel" "kvm-amd" "tun" ];
  boot.blacklistedKernelModules = [ ];

  # Loading the wrong kvm module is harmless and logs one line; not loading the
  # right one is fatal. Suppress the noise rather than guessing the vendor.
  boot.extraModprobeConfig = ''
    options kvm-intel nested=0
    options kvm-amd nested=0
  '';

  virtualisation.libvirtd.enable = false;
  hardware.graphics.enable = lib.mkDefault false;
  };
}
