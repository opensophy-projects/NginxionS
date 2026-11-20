#!/bin/bash
# NginxionS: the processes of the openappsec container (deploy/openappsec/Dockerfile):
#   - the open-appsec agent (/nginxions-entry.sh: the settings of WAF -> Agent, then the upstream entry.sh);
#   - its shared storage (decisions.data, learning state) and tuning (statistics, suggestions) services;
#   - smartsync (the learning of several servers put together) on a manager: while the settings of the agent written by
#     NginxionS say NGINXIONS_SMARTSYNC=true (a server with nodes, docs/adr/0012-nodes.md 5c), otherwise it waits.
# Each is started again when it stops. nginxions-control (a container of its own, deploy/compose.yaml) restarts this
# container to apply the settings of the agent (read at its start). TERM to the container stops them all.
# The container owns the network namespace nginxions joins: the services listen on ports nginx leaves free.
set -u

SHARED_STORAGE_PORT="${NGINXIONS_SHARED_STORAGE_PORT:-7811}"
TUNING_PORT="${NGINXIONS_TUNING_PORT:-7813}"
SMARTSYNC_PORT="${NGINXIONS_SMARTSYNC_PORT:-7815}"
AGENT_SETTINGS=/ext/appsec/nginxions-agent.env
AGENT_PID_FILE=/run/nginxions-agent.pid

log() { echo "nginxions-openappsec: $*" >&2; }

stopping=0
stop() {
    stopping=1
    # ignored here (the TERM to the group below reaches this shell too); the subshells have their own trap
    trap '' TERM INT
    log "stopping"
    # the agent first (its entry.sh stops the watchdog and the nano services), then the rest
    [ -s "$AGENT_PID_FILE" ] && kill -TERM "$(cat "$AGENT_PID_FILE")" 2>/dev/null
    sleep 2
    kill -TERM 0 2>/dev/null
    wait
    exit 0
}
trap stop TERM INT

# keep NAME COMMAND...: runs COMMAND again 5 s after it stops
keep() {
    local name="$1"
    shift
    (
        trap 'exit 0' TERM
        while true; do
            "$@"
            log "$name stopped (exit $?), starting it again in 5 s"
            sleep 5
        done
    ) &
}

shared_storage() {
    cd /opt/appsec-shared-storage || return 1
    SERVER_PORT="$SHARED_STORAGE_PORT" SERVER_ALTERNATIVE_PORT="$((SHARED_STORAGE_PORT + 1))" exec ./app
}

tuning() {
    cd /opt/appsec-tuning || return 1
    # the database password from its file (nginxions-init), not in the environment of the container
    local password=""
    [ -r "${QUERY_DB_PASSWORD_FILE:-}" ] && password=$(cat "$QUERY_DB_PASSWORD_FILE")
    SERVER_PORT="$TUNING_PORT" SHARED_STORAGE_HOST="127.0.0.1:$SHARED_STORAGE_PORT" QUERY_DB_PASSWORD="$password" \
        exec ./app
}

smartsync() {
    # off: checked every 30 s, so a server that gets nodes starts it (it keeps running if they all go)
    while ! grep -qx 'NGINXIONS_SMARTSYNC=true' "$AGENT_SETTINGS" 2>/dev/null; do
        sleep 30
    done
    cd /opt/appsec-smartsync || return 1
    log "smartsync: on (this server has nodes)"
    # standalone: REST /api/sync and a file lock, no Kafka or Redis; the lock directory ends with "/" (its keys are
    # appended to it)
    APPSEC_MODE=standalone SERVER_PORT="$SMARTSYNC_PORT" SERVER_ALTERNATIVE_PORT="$((SMARTSYNC_PORT + 1))" \
        SHARED_STORAGE_HOST="127.0.0.1:$SHARED_STORAGE_PORT" FLOCK_ROOT=/tmp/nginxions-smartsync/ LOG_LEVEL=info \
        exec ./app
}

agent() {
    /nginxions-entry.sh "$@" &
    echo $! > "$AGENT_PID_FILE"
    wait $!
}

keep shared-storage shared_storage
keep tuning tuning
[ -x /opt/appsec-smartsync/app ] && keep smartsync smartsync

# the agent in the foreground loop: started again when it stops, a TERM to the container ends here
while [ "$stopping" = 0 ]; do
    agent "$@"
    code=$?
    [ "$stopping" = 1 ] && break
    log "the agent stopped (exit $code), starting it again"
    sleep 2
done
wait
