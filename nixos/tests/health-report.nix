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

  # PUBLIC DNS, stated rather than inferred.
  #
  # Three separate failures in one day traced back to a box that could not
  # resolve public names while every other sign said the network was healthy —
  # tailnet up, certificate valid, dashboard answering. The profile catalogue
  # failed to clone with a git error, the server container kept a stale
  # resolv.conf, and the unattended upgrade re-locked to its CACHED revision and
  # exited 0. Not one of them said "DNS".
  #
  # The sandbox has no network, so what is asserted is that the report SAYS
  # something about resolution either way — not that it resolves. A report that
  # silently omits the field on the boxes that need it is the bug.
  case "$printed" in
    *"dns:"*) ;;
    *)
      echo "the report says nothing about public DNS:" >&2
      echo "$printed" >&2
      exit 1
      ;;
  esac

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

  # Every unit line has to name its unit. `systemctl is-active` exits 3 for an
  # inactive unit, so `$(systemctl is-active X || echo absent)` ran the fallback
  # IN ADDITION to succeeding: the substitution became "inactive\nabsent" and the
  # report printed a headless `absent (restarts: 0)` line under the real one.
  # Every report all evening carried it — on the box and in CI — and it reads as
  # a unit nobody can identify, which is the worst thing a health report can say.
  # Followed by a space or a bracket, never a colon: `failed:` and `uptime:` are
  # field LABELS that legitimately begin a line, and a pattern that eats them
  # fails on a healthy report.
  orphan=$(printf '%s\n' "$printed" | grep -nE '^(active|inactive|failed|absent|activating|deactivating)( |\()' || true)
  if [ -n "$orphan" ]; then
    echo "a unit line in the report does not name its unit:" >&2
    printf '%s\n' "$orphan" >&2
    exit 1
  fi

  # And the shape that caused it, asserted against the shipped program — because
  # the runtime check above cannot reach it here: this sandbox has no system bus,
  # so `is-active` prints NOTHING and only the fallback runs. The defect needs a
  # real systemd, where the command answers truthfully and still exits non-zero.
  # Comments stripped first. The shipped script explains this defect in prose
  # that contains the defect's own shape, so an unfiltered grep matches the
  # warning and fails on a correct program — which it duly did.
  if grep -vE '^[[:space:]]*#' "$(command -v appliance-health-report)" \
     | grep -qE 'is-active [^)]*\|\| echo'; then
    echo "the report applies its fallback inside the substitution:" >&2
    echo "  \$(systemctl is-active X || echo absent) runs BOTH when X is inactive," >&2
    echo "  because is-active exits 3 for a true answer. Capture, then default." >&2
    exit 1
  fi

  # Same trap, one field down: `getent` absent does not make the DNS line absent,
  # it makes it say CANNOT RESOLVE — forever, on a box whose DNS is fine. The
  # line-exists assertion above is green against that mutation; measured.
  # Anchored to the PATH line for the reason the openssl note below gives.
  if ! grep -m1 '^export PATH=' "$(command -v appliance-health-report)" | grep -q 'glibc'; then
    echo "getent is not on the report's PATH, so the DNS line would report a" >&2
    echo "resolution failure on every box regardless of whether one exists." >&2
    exit 1
  fi

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
