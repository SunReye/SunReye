#!/usr/bin/with-contenv bashio
# Logical backup of the SunReye database to /data/backups/<name>.dump.
#
# By default the raw 1 Hz hypertable chunks are excluded: metrics_raw only
# holds a 7-day retention window that is fully materialized into the rollups,
# and dumping it decompressed can be tens of GB. The rollups (long-horizon
# history), settings, auth, tariffs, and installed profiles — the irreplaceable
# state — are always included. `backup_full: true` dumps everything.
#
# Restore with: pg_restore -d "$DATABASE_URL" --no-owner <file>
# (run `SELECT timescaledb_pre_restore();` / `timescaledb_post_restore();`
# around it — see DOCS.md).
set -euo pipefail

name="$1"
mkdir -p /data/backups

exclude_args=()
if ! bashio::config.true 'backup_full'; then
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
