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
# Raw outliving any aggregate built from it — or either retention being
# unreadable — means the data is INCLUDED and the reason is logged. A backup tool
# must fail toward keeping data.
#
# Restore with: pg_restore -d "$DATABASE_URL" --no-owner <file>
# (run `SELECT timescaledb_pre_restore();` / `timescaledb_post_restore();`
# around it — see DOCS.md).
set -euo pipefail

name="$1"
mkdir -p /data/backups

# Whether raw chunk data can be excluded without losing history that lives
# nowhere else — derived, not a magic number.
#
# Excluding raw is safe exactly while raw is "fully materialized into the
# rollups": every raw row's bucket must still exist in every aggregate built from
# it. That is true iff raw's retention is FINITE and no coarser tier drops its
# buckets sooner. If raw outlives a rollup tier, there is a time range only raw
# covers, and excluding it drops that range from the backup — silently, since the
# dump is still smaller than a full one.
#
# Arguments are days: raw retention, then the SHORTEST retention among the
# aggregates. `-1` means "no policy" on either side — for raw that is "kept
# forever" and is never safe to exclude; for the aggregates it means every tier
# is kept forever, which is always safe.
#
# What `backup_full: false` still gives up is *resolution* on restore, not
# coverage: the rollups keep the span, at their own bucket widths. That is the
# flag's whole purpose.
safe_to_exclude_raw() {
    local raw="$1" rollups="$2" arg
    # Each argument on its own: concatenating them would let an empty raw hide
    # behind a numeric rollup value, and awk reads an empty string as 0.
    for arg in "$raw" "$rollups"; do
        case "$arg" in
            '' | *[!0-9.-]*) return 1 ;;
        esac
    done
    awk -v raw="$raw" -v roll="$rollups" \
        'BEGIN { exit !(raw >= 0 && (roll < 0 || raw <= roll)) }'
}

exclude_args=()
raw_retention_days=""
rollup_retention_days=""
if ! bashio::config.true 'backup_full'; then
    # Both retentions in days, from the policies themselves rather than from an
    # assumption: `-1` where no policy exists, empty when the query could not run.
    retentions="$(psql -X -d "$DATABASE_URL" -tAc \
        "SELECT coalesce(
                  extract(epoch FROM (
                    SELECT (config->>'drop_after')::interval
                      FROM timescaledb_information.jobs
                     WHERE proc_name = 'policy_retention'
                       AND hypertable_name = 'metrics_raw'
                     LIMIT 1
                  )) / 86400,
                  -1)
           || ' ' ||
           coalesce((
             SELECT min(extract(epoch FROM (config->>'drop_after')::interval)) / 86400
               FROM timescaledb_information.jobs
              WHERE proc_name = 'policy_retention'
                AND hypertable_name <> 'metrics_raw'
           ), -1)" \
        2>/dev/null || true)"
    raw_retention_days="$(echo "$retentions" | awk '{ print $1 }' | tr -d '[:space:]')"
    rollup_retention_days="$(echo "$retentions" | awk '{ print $2 }' | tr -d '[:space:]')"
fi

if ! bashio::config.true 'backup_full' &&
    ! safe_to_exclude_raw "$raw_retention_days" "$rollup_retention_days"; then
    bashio::log.warning \
        "metrics_raw retention is '${raw_retention_days:-unreadable}' day(s) against a shortest rollup retention of '${rollup_retention_days:-unreadable}': raw is no longer fully materialized into the rollups, so its chunk data is INCLUDED in this backup despite backup_full: false — excluding it would drop a time range that lives nowhere else."
fi

if ! bashio::config.true 'backup_full' &&
    safe_to_exclude_raw "$raw_retention_days" "$rollup_retention_days"; then
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
