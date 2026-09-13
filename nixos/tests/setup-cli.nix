/*
  `sunreye-setup` has to start.

  The CLI is the only way to reconfigure a box that may be behind a NAT on
  someone else's roof, and nothing built it in isolation: the twenty-minute boot
  test was the first thing that ever ran it, and it reported `setup-show: FAILED`
  for a missing runtime dependency — an import error, on every subcommand, on
  every image built since the CLI gained that import.

  `--help` is the whole of the check on purpose. It needs no /etc/nixos, no
  systemd and no tailnet, but it loads every module the tool has, which is where
  a dependency that is not in the closure announces itself.
*/
{ pkgs, sunreye-setup }:
pkgs.runCommand "setup-cli-runs"
{
  nativeBuildInputs = [ sunreye-setup ];
} ''
  set -o pipefail

  if ! printed=$(sunreye-setup --help 2>&1); then
    echo "sunreye-setup --help exited non-zero:" >&2
    echo "$printed" >&2
    exit 1
  fi

  # A resolution failure is the specific defect this check exists for, and it is
  # worth naming: bun reports it on stdout and it does not look like a crash.
  case "$printed" in
    *"Cannot find package"* | *"Cannot find module"*)
      echo "sunreye-setup cannot resolve its own dependencies:" >&2
      echo "$printed" >&2
      exit 1
      ;;
  esac

  case "$printed" in
    *"sunreye-setup — configure this SunReye appliance"*) ;;
    *)
      echo "sunreye-setup --help printed something unexpected:" >&2
      echo "$printed" >&2
      exit 1
      ;;
  esac

  touch "$out"
''
