/*
  The NVRAM entry, decided against a fabricated machine.

  Three things matter and none of them can be seen from a booted box that
  already works: that a BIOS boot writes nothing, that a box which already has
  an entry does not collect a second one every time it starts, and that a box
  with none gets exactly one pointing at the removable fallback path its image
  actually installs.

  Fabricated, because the alternative is to assert nothing: the sandbox has no
  firmware, no GPT disk and no NVRAM, and a check that merely runs the script
  would pass just as well if it made no decision at all. The overrides it uses
  are the seam the script documents.
*/
{ pkgs, ensure }:
pkgs.runCommand "efi-boot-entry-decides"
{
  nativeBuildInputs = [ ensure pkgs.coreutils ];
} ''
  set -o pipefail
  work=$(mktemp -d)

  # Records what it was asked to do, and answers `-v` from a file the test
  # controls — which is the whole of what the script reads NVRAM through.
  cat > "$work/efibootmgr" <<'SH'
  #!/bin/sh
  if [ "$1" = "-v" ]; then cat "$NVRAM"; exit 0; fi
  printf '%s\n' "$*" >> "$CALLS"
SH
  chmod +x "$work/efibootmgr"

  export EFIBOOTMGR="$work/efibootmgr"
  export NVRAM="$work/nvram" CALLS="$work/calls"
  export ESP_DEVICE=/dev/sda1 ESP_DISK=/dev/sda ESP_PARTNUM=1
  export ESP_PARTUUID=1c06f03b-704e-4657-b9cd-681a087a2fdc

  # ── A BIOS boot has no NVRAM to write to, and nothing is wrong ─────────────
  : > "$NVRAM"; : > "$CALLS"
  EFI_MARKER="$work/absent" appliance-efi-boot-entry >/dev/null
  if [ -s "$CALLS" ]; then
    echo "wrote a boot entry on a machine that did not boot via EFI:" >&2
    cat "$CALLS" >&2
    exit 1
  fi

  mkdir -p "$work/efi"
  export EFI_MARKER="$work/efi"

  # ── No entry for this disk: create exactly one ─────────────────────────────
  : > "$NVRAM"; : > "$CALLS"
  appliance-efi-boot-entry >/dev/null
  if [ "$(wc -l < "$CALLS")" != "1" ]; then
    echo "expected exactly one efibootmgr call, got:" >&2
    cat "$CALLS" >&2
    exit 1
  fi
  # The loader has to be the path the image actually installs. An entry naming
  # \EFI\systemd\… or a vendor directory resolves to nothing on this ESP, and a
  # boot entry that points at a file that is not there is worse than none: the
  # firmware stops offering the fallback it would otherwise have taken.
  case "$(cat "$CALLS")" in
    *'--loader \EFI\BOOT\BOOTX64.EFI'*) ;;
    *)
      echo "the entry does not name the loader this image installs:" >&2
      cat "$CALLS" >&2
      exit 1
      ;;
  esac
  case "$(cat "$CALLS")" in
    *'--disk /dev/sda'*'--part 1'*) ;;
    *) echo "the entry does not name the ESP's disk and partition:" >&2; cat "$CALLS" >&2; exit 1 ;;
  esac

  # ── An entry already naming this partition: leave it alone ────────────────
  # Matched on the GPT GUID rather than the label, so a renamed entry is still
  # recognised and a same-named entry on a DIFFERENT disk is not.
  printf 'Boot0001* SunReye\tHD(1,GPT,%s,0x800,0x100000)/File(\\EFI\\BOOT\\BOOTX64.EFI)\n' \
    "$ESP_PARTUUID" > "$NVRAM"
  : > "$CALLS"
  appliance-efi-boot-entry >/dev/null
  if [ -s "$CALLS" ]; then
    echo "wrote a second entry for a partition NVRAM already names:" >&2
    cat "$CALLS" >&2
    exit 1
  fi

  # ── The firmware's OWN entry for the USB boot is not a usable entry ───────
  # Measured on a Futro S740: booting the flashed disk in a USB enclosure made
  # the firmware write its own NVRAM entry, and that entry carries this ESP's
  # GPT GUID. Matching on the GUID alone therefore concluded "already handled"
  # and wrote nothing — so the box was left with the one entry that CANNOT
  # survive the disk moving to the internal slot, because its device path pins
  # the USB hardware ahead of the partition.
  #
  # The discriminator is the device path: an entry that resolves by partition
  # alone begins with HD(. One that begins with PciRoot(...)/USB(...) names a
  # port, and a disk in a different port is a different device to firmware.
  printf 'Boot0005* UEFI: SanDisk\tPciRoot(0x0)/Pci(0x14,0x0)/USB(0x5,0x0)/HD(1,GPT,%s,0x800,0x100000)\n' \
    "$ESP_PARTUUID" > "$NVRAM"
  : > "$CALLS"
  appliance-efi-boot-entry >/dev/null
  if [ ! -s "$CALLS" ]; then
    echo "deferred to the firmware's USB-bound entry; the disk will not boot from its own slot" >&2
    exit 1
  fi

  # And having written ours, a later boot must recognise it and stop — the
  # USB-bound entry is still there, so this is the mixed state a real box is in.
  printf 'Boot0005* UEFI: SanDisk\tPciRoot(0x0)/Pci(0x14,0x0)/USB(0x5,0x0)/HD(1,GPT,%s,0x800,0x100000)\nBoot0006* SunReye\tHD(1,GPT,%s,0x800,0x100000)/File(\\EFI\\BOOT\\BOOTX64.EFI)\n' \
    "$ESP_PARTUUID" "$ESP_PARTUUID" > "$NVRAM"
  : > "$CALLS"
  appliance-efi-boot-entry >/dev/null
  if [ -s "$CALLS" ]; then
    echo "collected a duplicate entry on a box that already has a usable one:" >&2
    cat "$CALLS" >&2
    exit 1
  fi

  # ── An entry for a different disk is not this disk's entry ────────────────
  printf 'Boot0001* SunReye\tHD(1,GPT,ffffffff-0000-0000-0000-000000000000,0x800,0x100000)\n' > "$NVRAM"
  : > "$CALLS"
  appliance-efi-boot-entry >/dev/null
  if [ ! -s "$CALLS" ]; then
    echo "a same-named entry on another disk was mistaken for this one" >&2
    exit 1
  fi

  touch "$out"
''
