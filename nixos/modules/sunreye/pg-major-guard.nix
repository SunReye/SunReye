/*
  Refuse to start postgres on a datadir written by a different major.

  A datadir is only readable by the major that created it, and postgres reacts
  to the wrong one with an error loop that looks exactly like a crash. The addon
  does the same thing for the same reason
  (sunreye/rootfs/etc/s6-overlay/s6-rc.d/init-postgres/run).

  A package, and the path is an argument, so `checks.pg-major-guard` can run the
  real script against a datadir it fabricates. The previous version was an inline
  script that read `<stateDir>/postgres/PG_VERSION` — one directory above where
  PGDATA actually is — so it found no file, took its "nothing to check" exit and
  passed every time. A refusal that cannot fire is indistinguishable from one
  that never needed to.
*/
{ pkgs, versionFile }:
pkgs.writeShellApplication {
  name = "sunreye-pg-major-guard";
  runtimeInputs = [ pkgs.coreutils ];
  text = ''
    version_file=''${1:-${versionFile}}
    # No datadir yet is the first boot, which is the case this must not block.
    [ -e "$version_file" ] || exit 0
    found=$(cat "$version_file")
    if [ "$found" != "17" ]; then
      echo "Data directory is PostgreSQL $found, this appliance ships PostgreSQL 17." >&2
      echo "A migration between PostgreSQL majors needs a dedicated transition" >&2
      echo "release — do not roll the appliance back; check the SunReye release" >&2
      echo "notes for the upgrade path." >&2
      exit 1
    fi
  '';
}
