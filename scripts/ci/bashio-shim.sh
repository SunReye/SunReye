# Minimal `bashio` stand-in so the addon's shipped scripts can run in CI.
#
# `dump.sh` is `#!/usr/bin/with-contenv bashio` — that interpreter only exists
# inside the Home Assistant base image. Rather than keeping a CI copy of the
# dump commands (the copy is what rots), the shim provides the three bashio
# calls dump.sh makes and the script is *sourced*: CI exercises the shipped
# file, byte for byte.
#
#   source scripts/ci/bashio-shim.sh
#   BACKUP_FULL=true . sunreye/rootfs/usr/lib/sunreye/dump.sh my-dump
#
# Options come from env vars named after them (BACKUP_FULL, BACKUPS_KEEP), so a
# CI step can drive both dump modes.

bashio::config.true() {
    case "$1" in
        backup_full) [ "${BACKUP_FULL:-false}" = "true" ] ;;
        *) return 1 ;;
    esac
}

bashio::config() {
    case "$1" in
        backups_keep) echo "${BACKUPS_KEEP-${2:-}}" ;;
        *) echo "${2:-}" ;;
    esac
}

bashio::log.info() { echo "[info] $*"; }
