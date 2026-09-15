# Where the database actually lives, asserted against the command that mounts it.
#
# The appliance shipped for weeks with a datadir that was never on the disk.
# The mount was the PARENT of PGDATA:
#
#     volumes = [ "${pgMount}:/var/lib/postgresql" ];
#
# and the image declares `VOLUME /var/lib/postgresql/data`, a level deeper. A
# declared VOLUME with nothing explicitly mounted on it gets an ANONYMOUS volume,
# which shadows the bind-mounted parent — so postgres wrote its cluster there and
# the host's `postgres/data` stayed empty at 4 KB. Podman removes anonymous
# volumes with the container, and `--rm` is how these units stop, so every
# container recreation — every upgrade — started from an empty cluster.
#
# From the outside it looked like the database "resetting itself" after an
# upgrade: the admin account gone, onboarding asking again, and a datadir on disk
# with a plausible date on it. Nothing failed, nothing was logged, and the box
# came up healthy each time.
#
# So: the mount target must be PGDATA ITSELF. Asserted on the generated start
# script, because the podman arguments are what the box runs, and this defect was
# invisible to every other gate — evaluation, the boot test and the health report
# all pass with a perfectly working database that happens to be disposable.
{ pkgs, postgresStart, pgData }:
pkgs.runCommand "pg-datadir" { } ''
  start=${postgresStart}
  fail=0
  note() { echo "  ✖ $1"; fail=1; }

  # The host path has to land ON PGDATA. Anything shallower leaves the image's
  # declared VOLUME uncovered, and uncovered means anonymous means disposable.
  grep -qF -- '${pgData}:/var/lib/postgresql/data' "$start" \
    || note "does not mount the host datadir at /var/lib/postgresql/data"

  # And must NOT mount the parent instead. This is the exact spelling that
  # shipped, so it is the exact spelling that has to stay gone: a mount at the
  # parent is silently shadowed by the image's own VOLUME.
  if grep -qE -- '[^/]:/var/lib/postgresql( |$|\\)' "$start"; then
    note "mounts the PARENT of PGDATA — the image's declared VOLUME shadows it"
  fi

  if [ $fail -ne 0 ]; then
    echo
    echo "--- podman-sunreye-postgres-start ---"
    cat "$start"
    exit 1
  fi
  echo "datadir is mounted at PGDATA and survives a container recreation"
  touch $out
''
