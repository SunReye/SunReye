/*
  The refusal has to refuse — and, just as importantly, has to stay quiet on a
  first boot.

  This is the check that would have caught the guard reading the wrong path:
  it fabricates a datadir, so a guard pointed one directory too high finds
  nothing and returns 0 where this test demands a refusal.
*/
{ pkgs, guard }:
pkgs.runCommand "pg-major-guard-refuses" { nativeBuildInputs = [ guard ]; } ''
  set -o pipefail
  work=$(mktemp -d)

  # First boot: no datadir at all. Must not block.
  if ! sunreye-pg-major-guard "$work/absent/PG_VERSION"; then
    echo "the guard blocked a first boot, where there is no datadir yet" >&2
    exit 1
  fi

  # The major this image ships.
  mkdir -p "$work/ok"
  echo 17 > "$work/ok/PG_VERSION"
  if ! sunreye-pg-major-guard "$work/ok/PG_VERSION"; then
    echo "the guard refused its own PostgreSQL major" >&2
    exit 1
  fi

  # A datadir from another major: postgres would error-loop on this, so the box
  # has to stop instead.
  mkdir -p "$work/old"
  echo 15 > "$work/old/PG_VERSION"
  if message=$(sunreye-pg-major-guard "$work/old/PG_VERSION" 2>&1); then
    echo "the guard accepted a PostgreSQL 15 datadir:" >&2
    echo "$message" >&2
    exit 1
  fi
  case "$message" in
    *"PostgreSQL 15"*) ;;
    *)
      echo "the refusal does not say which major it found:" >&2
      echo "$message" >&2
      exit 1
      ;;
  esac

  # Everything above hands the guard a path, which is exactly how the original
  # defect survived: the bug was in the path it reads when nobody passes one.
  if ! grep -q '/postgres/data/PG_VERSION' "$(command -v sunreye-pg-major-guard)"; then
    echo "the guard's default is not the datadir PGDATA actually uses:" >&2
    grep -o 'version_file=[^ ]*' "$(command -v sunreye-pg-major-guard)" >&2
    exit 1
  fi

  touch "$out"
''
