# Emergency disk-space reserve.
#
# origin: nixos-sh-appliance@2f444121c544 (header retargeted; the tool and the
# boot-tested caps are unchanged).
#
# The problem: the workload's state — here a Postgres datadir ingesting at 1 Hz
# plus its backups — shares the root filesystem, so a retention policy that stops
# firing can take the host to 100%. On a headless box in someone else's house
# that is close to unrecoverable — no writes, no GC, no rebuild, no journal.
#
# What this deliberately is NOT: an ext4 project quota. That was the first design
# and it was abandoned after a boot test. Enabling the `project`/`quota` features
# from initrd — even via `tune2fs -Q prjquota`, which avoids the mount option that
# ext4 can refuse outright — left the kernel unable to mount the root filesystem:
#
#     [  OK  ] Finished Enable ext4 project quota features on the root filesystem.
#              Mounting /sysroot...
#     [   38.548670] EXT4-fs (vda): mount failed
#     [  OK  ] Reached target Emergency Mode.
#
# An unbootable appliance is a categorically worse outcome than an uncapped one. A
# reserve file has no such failure mode: worst case it is absent.
#
# What this buys is host recoverability: enough space, instantly, to run a GC and
# fix the cause over SSH.
{ config, lib, pkgs, ... }:
let
  cfg = config.appliance;
  dir = "/var/lib/appliance";
  file = "${dir}/ballast";

  tool = pkgs.writeShellApplication {
    name = "appliance-ballast";
    runtimeInputs = with pkgs; [ coreutils util-linux ];
    text = ''
      size=${cfg.ballast}
      case "''${1:-status}" in
        status)
          # Never fails: this is diagnostics, and a failing unit would page you.
          if [ -e ${file} ]; then
            echo "ballast present: $(du -h ${file} | cut -f1)"
          else
            echo "ballast ABSENT — either released, or never created."
          fi
          df -h / | tail -1
          ;;

        release)
          if [ ! -e ${file} ]; then echo "no ballast to release" >&2; exit 1; fi
          rm -f ${file}
          echo "released. free now: $(df -h --output=avail / | tail -1 | tr -d ' ')"
          echo
          echo "This is breathing room, not a fix. Find the cause, then restore it:"
          echo "  df -h /; du -sh /var/lib/sunreye/* | sort -h | tail"
          echo "  nix-collect-garbage -d"
          echo "  appliance-ballast restore"
          ;;

        restore|create)
          if [ -e ${file} ]; then echo "ballast already present"; exit 0; fi
          if [ "$size" = "0" ]; then echo "ballast disabled (size 0)"; exit 0; fi

          want=$(numfmt --from=iec "$size")
          total=$(df -B1 --output=size / | tail -1)
          avail=$(df -B1 --output=avail / | tail -1)

          # Never let the reserve itself become the thing that fills the disk. Cap
          # at a quarter of the filesystem, and always leave 1 GiB free after.
          # Found by a boot test: on a small root an uncapped fallocate ran out of
          # space, left a partial file behind, and took dhcpcd and logind down with
          # it — the reserve causing the exact failure it exists to prevent.
          max=$((total / 4))
          if [ "$want" -gt "$max" ]; then
            echo "capping ballast at 25% of the filesystem ($(numfmt --to=iec "$max"))"
            want=$max
          fi
          if [ $((avail - want)) -lt 1073741824 ]; then
            echo "only $(numfmt --to=iec "$avail") free — skipping ballast rather than" >&2
            echo "making a tight disk tighter. Free some space, then: appliance-ballast restore" >&2
            exit 0
          fi

          install -d -m 0755 ${dir}
          # fallocate reserves extents without writing — no flash wear.
          if fallocate -l "$want" ${file} 2>/dev/null; then
            echo "ballast reserved: $(numfmt --to=iec "$want")"
          else
            # A failed fallocate can leave a partially allocated file behind, which
            # is the opposite of helpful.
            rm -f ${file}
            echo "could not reserve $(numfmt --to=iec "$want"); continuing without ballast" >&2
          fi
          ;;

        *)
          echo "usage: appliance-ballast [status|release|restore]" >&2; exit 1 ;;
      esac
    '';
  };
in
lib.mkIf (cfg.enable && cfg.ballast != "0") {
  environment.systemPackages = [ tool ];

  systemd.services.appliance-ballast = {
    description = "Maintain the emergency disk-space reserve";
    wantedBy = [ "multi-user.target" ];
    # After the root filesystem has been grown, or we would size it against the
    # unexpanded image and never revisit it.
    after = [ "local-fs.target" "systemd-growfs-root.service" ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      ExecStart = "${lib.getExe tool} restore";
    };
  };
}
