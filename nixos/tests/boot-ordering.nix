# The order the box starts in, asserted against the units it actually ships.
#
# Measured on CI run 34946583947, first boot: `sunreye-migrate` found Postgres
# still initialising, exited, and scheduled its retry 30 s out. The server
# container started into that gap, met a database with no `app_settings` table,
# and crashed — ten times inside one second, which is its whole restart budget.
# Migrations succeeded on the retry; the server never came back, because a unit
# that has hit its start limit is not restarted by anything. The box was up, the
# dashboard was gone, and nothing about it was transient.
#
# Two separate facts keep that from happening, and both are asserted here
# because either one alone leaves a hole:
#
#   - the server starts AFTER migrations have succeeded, so it cannot meet a
#     half-migrated schema at all;
#   - and if it does fail, it keeps retrying for longer than the migrator's own
#     retry takes, so a lost race is recoverable rather than terminal.
#
# Asserted against the generated unit FILES rather than the options that produce
# them: `after = [ ... ]` in a module is an input, and the question here is what
# systemd is handed.
{ pkgs, serverUnit, migrateUnit, serverStart }:
pkgs.runCommand "boot-ordering" { } ''
  server=${serverUnit}
  migrate=${migrateUnit}
  start=${serverStart}

  fail=0
  note() { echo "  ✖ $1"; fail=1; }

  # `grep -q` against the directive, anchored: `After=` appears in a comment in
  # neither file today, and an unanchored match would pass on one tomorrow.
  has() { grep -qE "^$2" "$1"; }

  echo "== podman-sunreye-server.service =="
  has "$server" 'After=.*\bsunreye-migrate\.service\b' \
    || note "does not start after sunreye-migrate.service — it can race the schema"
  # WANTS, deliberately, not Requires. `Requires` would make a late migration
  # terminal rather than slow: a failed migrator takes the server's start job
  # down with it, and nothing re-triggers that job when the migrator's own retry
  # succeeds thirty seconds later. The server would sit inactive on a box with a
  # perfectly good schema. Wants orders without coupling the failure.
  has "$server" 'Wants=.*\bsunreye-migrate\.service\b' \
    || note "does not want sunreye-migrate.service — nothing expresses that it needs a migrated schema"
  grep -qE '^Requires=.*\bsunreye-migrate\.service\b' "$server" \
    && note "REQUIRES sunreye-migrate.service — a failed migration would leave the server inactive even after the retry succeeds"

  # The budget itself. A burst inside a few seconds is not a budget, it is a
  # coin toss against the 30 s the migrator waits before trying again.
  if has "$server" 'StartLimitIntervalSec=0'; then
    echo "  ok: restarts are not rate-limited"
  else
    note "start limit is still on — a crash loop shorter than the migrator's retry becomes permanent"
  fi
  # Spacing, so the retries actually span the migrator's 30 s rather than being
  # spent in the first second. Without the limit above this is only politeness;
  # with it, the two together are the recovery.
  has "$server" 'RestartSec=' \
    || note "no RestartSec — restarts land back to back instead of outlasting the migrator"

  # The container's view of DNS must TRACK the host's, not snapshot it.
  #
  # Podman writes /etc/resolv.conf into a container when it is created, copying
  # whatever the host had at that moment. The host's resolvers then change —
  # enrolling into a tailnet replaces them outright — and the container keeps the
  # stale file for as long as it lives. Measured on a box whose host resolved
  # github.com perfectly while the server inside could not, so the profile
  # catalogue failed to clone with a DNS error three layers from its cause.
  #
  # A bind mount makes the file live, which is the whole fix: --network=host
  # already means the container shares the host's stack, so it should share the
  # host's idea of who answers queries too.
  # The mount SPEC alone: podman's arguments are rendered one per line, so a
  # pattern joining the flag to its value matches nothing even when the mount is
  # there. It did exactly that first.
  grep -qF -- '/etc/resolv.conf:/etc/resolv.conf:ro' "$start" \
    || note "does not bind-mount the host's /etc/resolv.conf — the container's DNS is frozen at creation"

  echo "== sunreye-migrate.service =="
  has "$migrate" 'After=.*\bpodman-sunreye-postgres\.service\b' \
    || note "does not start after the database container"

  if [ $fail -ne 0 ]; then
    echo
    echo "--- podman-sunreye-server.service ---"; cat "$server"
    echo "--- sunreye-migrate.service ---"; cat "$migrate"
    exit 1
  fi
  echo "boot ordering ok"
  touch $out
''
