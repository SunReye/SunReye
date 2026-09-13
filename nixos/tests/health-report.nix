/*
  The health report has to run.

  It is the box's own account of itself — the thing a webhook posts and the
  thing `appliance-failure@` drops in the journal next to a failure — and it is
  a shell script that, until this check existed, only ever executed on a booted
  appliance. A command in it that fails prints its error to stderr and leaves an
  empty field in the report: `uptime -p` did exactly that on every image, because
  coreutils ships an `uptime` that comes first in the wrapper's PATH and has no
  such flag.

  The sandbox has /proc, so uptime, df, free and the watchdog scan are all real
  here. systemctl finds no system bus and the script's own fallbacks turn that
  into `absent`, which is the same thing it prints for a unit that is not
  installed — so the check asserts on the fields that do not depend on systemd.
*/
{ pkgs, report }:
pkgs.runCommand "health-report-runs"
{
  nativeBuildInputs = [ report ];
} ''
  set -o pipefail

  if ! printed=$(appliance-health-report 2>&1); then
    echo "appliance-health-report exited non-zero:" >&2
    echo "$printed" >&2
    exit 1
  fi

  # Every tool it calls is on its PATH and accepts the flags it is given. This is
  # the whole defect class: the report keeps going and hands back a blank.
  case "$printed" in
    *"invalid option"* | *"command not found"* | *"unrecognized option"*)
      echo "the report ran a command that rejected it:" >&2
      echo "$printed" >&2
      exit 1
      ;;
  esac

  # The header names the box. It came out blank because the fallback for "the
  # identity unit has not written its file yet" called a command that is not on
  # this PATH — the one situation the fallback is for.
  case "$printed" in
    *"=== appliance health: "[!$' \n']*) ;;
    *)
      echo "the report did not name the box:" >&2
      echo "$printed" >&2
      exit 1
      ;;
  esac

  # An empty field is the symptom a passing exit code hides, so the fields that
  # do not need a booted system are asserted to carry a value.
  # `tailnet-cert:` is the newest of these and the most likely to be a blank:
  # it shells out to openssl, which is exactly the kind of tool that is missing
  # from a wrapper's PATH. Unenrolled here, so it reports that and stops — the
  # branch that actually calls openssl only runs on an enrolled box, and is
  # verified there rather than pretended at here.
  for field in "uptime:" "disk:" "memory:" "watchdog:" "tailnet-cert:"; do
    line=$(printf '%s\n' "$printed" | grep -m1 "^$field" || true)
    value=''${line#"$field"}
    if [ -z "$(printf '%s' "$value" | tr -d '[:space:]')" ]; then
      echo "the report printed an empty '$field' field:" >&2
      echo "$printed" >&2
      exit 1
    fi
  done

  # The certificate branch calls openssl, and nothing above reaches it: this
  # sandbox has no tailnet, so the report stops at "not enrolled". Asserting the
  # tool is on the SHIPPED program's PATH is the part that can be checked here —
  # measured, removing openssl from runtimeInputs left every assertion above
  # green, which is precisely the shape of the `uptime -p` defect this file
  # exists for.
  # Anchored to the PATH line, not the file: `grep openssl` over the whole
  # script matches the command name in the branch itself, so it passes with the
  # tool absent. Measured — the first version of this assertion was green
  # against exactly the mutation it was written to catch.
  if ! grep -m1 '^export PATH=' "$(command -v appliance-health-report)" | grep -q 'openssl'; then
    echo "openssl is not on the report's PATH, so the certificate branch would" >&2
    echo "print a blank on every enrolled box and nothing here would notice." >&2
    exit 1
  fi

  touch "$out"
''
