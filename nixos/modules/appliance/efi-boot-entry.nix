# Make a flashed disk bootable from the slot it ends up in.
#
# The image installs GRUB as REMOVABLE — `\EFI\BOOT\BOOTX64.EFI`, no NVRAM entry
# — because an image built in a sandbox has never seen the target machine's
# firmware and cannot write a variable into it. That is what lets a freshly
# flashed unit boot at all (see ../appliance/filesystems.nix).
#
# It is only half the story. UEFI obliges firmware to honour that fallback path
# for REMOVABLE devices; for a fixed disk it is expected to boot from an NVRAM
# `Boot####` entry instead. Plenty of consumer boards fall back anyway. Corporate
# thin clients — the exact hardware this appliance is for — often do not.
#
# Measured on a Fujitsu Futro S740: the same disk boots first time in a USB
# enclosure and offers NO boot entry in the internal M.2 slot, while the BIOS
# drive diagnostic lists the drive perfectly. Nothing about the disk is wrong;
# the machine is waiting for a variable that no image can ship.
#
# So the box writes it itself, once it is running. An EFI boot entry identifies
# its partition by GPT GUID rather than by port, so an entry written while the
# disk is in a USB enclosure still resolves when the disk is moved to the
# internal slot — which is the whole recovery path for a unit that will not boot
# from its own slot yet.
{ config, lib, pkgs, ... }:
let
  cfg = config.appliance;

  ensure = pkgs.writeShellApplication {
    name = "appliance-efi-boot-entry";
    runtimeInputs = with pkgs; [ efibootmgr util-linux coreutils gnugrep ];
    text = ''
      # Every input has a discovery default and an override. The overrides are a
      # test seam, and deliberately so: the decisions below — "is there already
      # an entry for THIS partition", "which loader path" — are the whole of the
      # behaviour, and a check that cannot fabricate a disk can only assert that
      # the script runs.
      efi_marker=''${EFI_MARKER:-/sys/firmware/efi}
      esp_mount=''${ESP_MOUNT:-/boot}
      efibootmgr_cmd=''${EFIBOOTMGR:-efibootmgr}
      label=''${EFI_LABEL:-SunReye}

      # Not booted via EFI at all: a BIOS/CSM boot, or the QEMU guest the boot
      # test runs in. There is no NVRAM to write to and nothing is wrong.
      if [ ! -d "$efi_marker" ]; then
        echo "not an EFI boot; no boot entry to manage"
        exit 0
      fi

      device=''${ESP_DEVICE:-$(findmnt -no SOURCE "$esp_mount" 2>/dev/null || true)}
      if [ -z "$device" ]; then
        echo "no filesystem mounted at $esp_mount; leaving NVRAM alone" >&2
        exit 0
      fi

      partuuid=''${ESP_PARTUUID:-$(lsblk -no PARTUUID "$device" 2>/dev/null || true)}
      disk=''${ESP_DISK:-/dev/$(lsblk -no PKNAME "$device" 2>/dev/null || true)}
      partnum=''${ESP_PARTNUM:-$(lsblk -no PARTN "$device" 2>/dev/null || true)}

      if [ -z "$partuuid" ] || [ -z "$partnum" ] || [ "$disk" = "/dev/" ]; then
        echo "could not resolve $device to a GPT partition; leaving NVRAM alone" >&2
        exit 0
      fi

      # Matched on the partition GUID, not on the label: a label match would skip
      # a box whose entry names the same thing on a DIFFERENT disk, and would
      # write a duplicate every boot for one that had been renamed. The GUID is
      # what firmware resolves the entry by, so it is what "already present"
      # means.
      existing=$("$efibootmgr_cmd" -v 2>/dev/null || true)
      if printf '%s' "$existing" | grep -qiF "$partuuid"; then
        echo "NVRAM already has an entry for $partuuid"
        exit 0
      fi

      echo "no NVRAM entry for this disk; creating one so it boots from its own slot"
      "$efibootmgr_cmd" --create --disk "$disk" --part "$partnum" \
        --label "$label" --loader '\EFI\BOOT\BOOTX64.EFI'
    '';
  };
in
lib.mkIf (cfg.enable && cfg.efiBootEntry.enable) {
  # Exposed so `checks.efi-boot-entry` can run the shipped program rather than a
  # copy built beside it — the defect this exists for is in what the box runs.
  appliance.efiBootEntry.package = ensure;

  systemd.services.appliance-efi-boot-entry = {
    description = "Register this disk in NVRAM so firmware will boot it";
    wantedBy = [ "multi-user.target" ];
    # After the ESP is mounted: everything here is resolved from it.
    after = [ "local-fs.target" ];
    requires = [ "local-fs.target" ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      ExecStart = lib.getExe ensure;
    };
  };
}
