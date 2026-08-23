#!/usr/bin/env bash
# Restore a SunReye logical dump (written by dump.sh) into a database.
#
# This is the ONE implementation of the restore sequence: DOCS.md points here
# instead of printing the commands, and .github/workflows/db-restore.yml runs
# this exact file against a real TimescaleDB, so the documented path and the
# tested path cannot drift.
#
#   DATABASE_URL=... scripts/db-restore.sh /data/backups/<file>.dump [--force]
#
# TimescaleDB requires the restore to be bracketed by timescaledb_pre_restore()
# / timescaledb_post_restore(): the former stops background workers and relaxes
# the extension's own checks so compressed chunks and continuous-aggregate
# catalog rows can be written back, the latter re-arms the policies. post is
# always run, even when pg_restore fails, or the target is left with the
# extension in restoring mode.
#
# Two refusals, both before anything is written:
#   * the target was migrated by a NEWER SunReye than this checkout ships —
#     the inverse of the migrate-time downgrade guard. A half-applied restore
#     over a newer schema is the one case that corrupts silently.
#   * the target already holds SunReye data. A dump belongs in a fresh
#     database; --force is the deliberate override.
set -euo pipefail

force=false
dump=""
for arg in "$@"; do
    case "$arg" in
        --force) force=true ;;
        -*) echo "usage: db-restore.sh [--force] <file.dump>" >&2; exit 2 ;;
        *) dump="$arg" ;;
    esac
done

if [ -z "$dump" ]; then
    echo "usage: db-restore.sh [--force] <file.dump>" >&2
    exit 2
fi
if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL is not set — refusing to guess the target database." >&2
    exit 2
fi
if [ ! -f "$dump" ]; then
    echo "no such dump file: $dump" >&2
    exit 2
fi

# The newest migration this checkout ships. SUNREYE_JOURNAL exists because the
# compiled addon ships the SQL at /opt/sunreye/db/migrations.
journal="${SUNREYE_JOURNAL:-$(dirname "$0")/../packages/db/src/migrations/meta/_journal.json}"
shipped=0
if [ -f "$journal" ]; then
    shipped="$(grep -o '"when"[[:space:]]*:[[:space:]]*[0-9]*' "$journal" |
        grep -o '[0-9]*$' | sort -n | tail -n 1)"
    shipped="${shipped:-0}"
fi

psql_q() { psql -X -q -d "$DATABASE_URL" -tAc "$1"; }

# max(created_at) in the journal table, empty when the target was never migrated.
target="$(psql_q "SELECT coalesce(max(created_at)::text, '') FROM drizzle.__drizzle_migrations" \
    2>/dev/null || true)"
target="$(echo "$target" | tr -d '[:space:]')"
if [ -n "$target" ] && [ "$target" -gt "$shipped" ] 2>/dev/null; then
    echo "Refusing to restore: the target database was migrated by a newer SunReye release" \
        "(db journal $target > shipped $shipped). Upgrade this checkout, or restore into a fresh database." >&2
    exit 1
fi

if [ "$force" != true ]; then
    # `app_table_probe` is the marker the unit test matches on; the query asks
    # whether this database already holds SunReye rows.
    populated="$(psql_q "SELECT EXISTS (SELECT 1 FROM app_settings) /* app_table_probe */" \
        2>/dev/null || echo f)"
    populated="$(echo "$populated" | tr -d '[:space:]')"
    if [ "$populated" = "t" ]; then
        echo "Refusing to restore: the target database is not empty. Restore into a fresh" \
            "database, or pass --force to overwrite this one." >&2
        exit 1
    fi
fi

echo "Restoring $dump"
psql -X -q -d "$DATABASE_URL" -c "SELECT timescaledb_pre_restore();"

status=0
pg_restore -d "$DATABASE_URL" --no-owner "$dump" || status=$?

# Always re-arm, then report the restore's own outcome.
psql -X -q -d "$DATABASE_URL" -c "SELECT timescaledb_post_restore();"

if [ "$status" -ne 0 ]; then
    echo "pg_restore exited $status — the target database is NOT trustworthy." >&2
    exit "$status"
fi
echo "Restore complete. Start SunReye to let migrations bring the schema current."
