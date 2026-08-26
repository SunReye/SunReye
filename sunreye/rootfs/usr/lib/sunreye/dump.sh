#!/usr/bin/with-contenv bashio
# Logical backup of the SunReye database to /data/backups/<name>.dump.
#
# By default the raw hypertable chunks are excluded: metrics_raw holds a short
# retention window that is fully materialized into the rollups, and dumping it
# decompressed can be tens of GB. The rollups (long-horizon history), settings,
# auth, tariffs, and installed profiles — the irreplaceable state — are always
# included. `backup_full: true` dumps everything.
#
# That premise EXPIRES. Once metrics_raw becomes the long-horizon tier (a
# multi-year retention, or none at all), excluding it means the default backup
# silently stops covering years of history — a correct comment guarding a default
# that fails quietly. So it is no longer a comment: the retention policy is read
# from the live database and the exclusion is only applied while it still holds.
# Unreadable, absent, or longer than SAFE_EXCLUDE_MAX_DAYS means the data is
# INCLUDED and the reason is logged. A backup tool must fail toward keeping data.
#
# Restore with: pg_restore -d "$DATABASE_URL" --no-owner <file>
# (run `SELECT timescaledb_pre_restore();` / `timescaledb_post_restore();`
# around it — see DOCS.md).
set -euo pipefail

name="$1"
mkdir -p /data/backups

# The longest metrics_raw retention for which "fully materialized into the
# rollups" is still true. The widest continuous-aggregate refresh window is 3
# days, so 30 leaves a large margin while rejecting anything that is a history
# tier in its own right.
SAFE_EXCLUDE_MAX_DAYS=30

# Whether raw chunk data can be excluded without losing history that lives
# nowhere else. Argument is the retention in days, `-1` for "no policy", or
# anything unparseable when the query failed. Only a finite window inside the
# ceiling is safe; every other answer, including a failure to ask, is not.
safe_to_exclude_raw() {
    local days="$1"
    case "$days" in
        '' | *[!0-9.-]*) return 1 ;;
    esac
    awk -v d="$days" -v max="$SAFE_EXCLUDE_MAX_DAYS" \
        'BEGIN { exit !(d >= 0 && d <= max) }'
}

exclude_args=()
raw_retention_days=""
if ! bashio::config.true 'backup_full'; then
    # Days of metrics_raw retention, from the policy itself rather than from an
    # assumption: -1 when no policy exists (raw is kept forever), empty when the
    # query could not run.
    raw_retention_days="$(psql -X -d "$DATABASE_URL" -tAc \
        "SELECT coalesce(
                  extract(epoch FROM (
                    SELECT (config->>'drop_after')::interval
                      FROM timescaledb_information.jobs
                     WHERE proc_name = 'policy_retention'
                       AND hypertable_name = 'metrics_raw'
                     LIMIT 1
                  )) / 86400,
                  -1)" \
        2>/dev/null || true)"
    raw_retention_days="$(echo "$raw_retention_days" | tr -d '[:space:]')"
fi

if ! bashio::config.true 'backup_full' && ! safe_to_exclude_raw "$raw_retention_days"; then
    bashio::log.warning \
        "metrics_raw retention is '${raw_retention_days:-unreadable}' day(s), past the ${SAFE_EXCLUDE_MAX_DAYS}-day ceiling for treating it as a materialized window: raw chunk data is INCLUDED in this backup despite backup_full: false, because excluding it would drop history that lives nowhere else."
fi

if ! bashio::config.true 'backup_full' && safe_to_exclude_raw "$raw_retention_days"; then
    # Resolve the raw hypertable's chunk tables dynamically — their
    # _timescaledb_internal names encode a hypertable id we can't hardcode.
    #
    # Both halves are required. A *compressed* chunk's rows do not live in the
    # chunk table at all; they live in a separate `compress_hyper_*` table that
    # `timescaledb_information.chunks` does not name. Excluding only the chunk
    # names therefore left every compressed chunk fully dumped — silently, since
    # the dump was still smaller than a full one. The catalog is the only place
    # the compressed table's name is exposed, hence the join through
    # `compressed_chunk_id`.
    while IFS= read -r chunk; do
        [ -n "$chunk" ] && exclude_args+=("--exclude-table-data=$chunk")
    done < <(psql -X -d "$DATABASE_URL" -tAc \
        "SELECT format('%I.%I', c.schema_name, c.table_name)
           FROM _timescaledb_catalog.chunk c
           JOIN _timescaledb_catalog.hypertable h ON h.id = c.hypertable_id
          WHERE h.table_name = 'metrics_raw'
         UNION
         SELECT format('%I.%I', cc.schema_name, cc.table_name)
           FROM _timescaledb_catalog.chunk c
           JOIN _timescaledb_catalog.hypertable h ON h.id = c.hypertable_id
           JOIN _timescaledb_catalog.chunk cc ON cc.id = c.compressed_chunk_id
          WHERE h.table_name = 'metrics_raw'" \
        2>/dev/null || true)
fi

pg_dump -Fc -d "$DATABASE_URL" "${exclude_args[@]}" --file "/data/backups/${name}.dump"
bashio::log.info "Database dumped to /data/backups/${name}.dump"

# Rotate: keep the most recent N dumps (addon option, default 3). Sanitized —
# an unreadable option must never make the rotation eat every backup.
keep="$(bashio::config 'backups_keep' '3')"
case "${keep}" in
    '' | *[!0-9]*) keep=3 ;;
esac
ls -1t /data/backups/*.dump 2>/dev/null | tail -n "+$((keep + 1))" | while IFS= read -r old; do
    rm -f "$old"
    bashio::log.info "Rotated old backup ${old}"
done
