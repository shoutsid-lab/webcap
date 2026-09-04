#!/usr/bin/env bash
# Crash-resilience supervisor for webcap — for hosts without systemd, or as a safety net.
# Health-checks http://localhost:8080/v1/health every N seconds and restarts the service
# if it goes down. Detach it with:  setsid nohup ./supervise.sh >/dev/null 2>&1 &
set -euo pipefail

WEBCAP_DIR="${WEBCAP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
HOST="${SUP_HOST:-127.0.0.1}"
PORT="${SUP_PORT:-8080}"
INTERVAL="${SUP_INTERVAL:-10}"
LOG="${SUP_LOG:-/tmp/webcap-supervise.log}"
# The command used to (re)start the service, run from WEBCAP_DIR.
# Default runs the app directly (needs node_modules); override to add a tunnel if desired.
START_CMD="${START_CMD:-npx tsx src/main.ts}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG" >&2; }
healthy() { curl -fsS --max-time 5 "http://${HOST}:${PORT}/v1/health" >/dev/null 2>&1; }
stop() { log "supervisor stopping"; exit 0; }
trap stop SIGTERM SIGINT

log "supervisor starting (webcap=${WEBCAP_DIR}, check every ${INTERVAL}s, log=${LOG})"
while true; do
  if ! healthy; then
    log "health check failed; starting: ${START_CMD}"
    ( cd "$WEBCAP_DIR" && setsid nohup bash -c "$START_CMD" >>"$LOG" 2>&1 </dev/null & )
    sleep 5
  fi
  sleep "$INTERVAL"
done
