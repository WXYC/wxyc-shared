#!/usr/bin/env bats
#
# BATS tests for scripts/bs-lml-gate/poll-staging-health.sh.
#
# poll-staging-health.sh polls one URL until it returns HTTP 200 or the
# timeout elapses. Multiple URLs are polled in series — the gate calls
# this once per service. Polling-multiple-in-parallel is the workflow's
# concern, not the helper's.
#
# Inputs (env):
#   POLL_URL          — required, URL to GET
#   POLL_TIMEOUT_SECS — optional, default 300
#   POLL_INTERVAL_SECS— optional, default 5
#
# Exit:
#   0 on first 200
#   1 on timeout or DNS failure
#   2 on usage error

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../../bs-lml-gate" && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/poll-staging-health.sh"

setup() {
    TEST_TEMP_DIR="$(mktemp -d)"
}

teardown() {
    # SERVER_PID is written to a file (not exported) because start_*
    # runs inside a $(...) subshell, so a plain variable assignment
    # there would not propagate back here.
    if [[ -f "$TEST_TEMP_DIR/server.pid" ]]; then
        local pid
        pid="$(cat "$TEST_TEMP_DIR/server.pid")"
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
            wait "$pid" 2>/dev/null || true
        fi
    fi
    rm -rf "$TEST_TEMP_DIR"
}

# Spin up a Python HTTP server that returns the response codes listed in
# $TEST_TEMP_DIR/sequence.txt, one per request, falling through to the last
# value once exhausted. Returns the chosen port on stdout.
start_sequenced_server() {
    local seq_file="$TEST_TEMP_DIR/sequence.txt"
    local port_file="$TEST_TEMP_DIR/server.port"
    cat >"$TEST_TEMP_DIR/server.py" <<'PY_EOF'
import http.server, socketserver, sys, threading
seq_path = sys.argv[1]
port_path = sys.argv[2]
with open(seq_path) as f:
    seq = [int(line.strip()) for line in f if line.strip()]
i = [0]
lock = threading.Lock()
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        with lock:
            code = seq[i[0]] if i[0] < len(seq) else seq[-1]
            i[0] += 1
        self.send_response(code)
        self.send_header("Content-Length", "0")
        self.end_headers()
    def log_message(self, *a, **k):
        pass
with socketserver.TCPServer(("127.0.0.1", 0), H) as s:
    with open(port_path, "w") as f:
        f.write(str(s.server_address[1]))
    s.serve_forever()
PY_EOF
    python3 "$TEST_TEMP_DIR/server.py" "$seq_file" "$port_file" >/dev/null 2>&1 &
    echo $! >"$TEST_TEMP_DIR/server.pid"
    # wait for port_file to be written
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        if [[ -s "$port_file" ]]; then break; fi
        sleep 0.1
    done
    cat "$port_file"
}

@test "exits 0 immediately when server returns 200" {
    echo "200" >"$TEST_TEMP_DIR/sequence.txt"
    port=$(start_sequenced_server)
    export POLL_URL="http://127.0.0.1:${port}/health"
    export POLL_TIMEOUT_SECS=10
    export POLL_INTERVAL_SECS=1
    run "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "polls until 200 after several 503s" {
    printf '503\n503\n503\n200\n' >"$TEST_TEMP_DIR/sequence.txt"
    port=$(start_sequenced_server)
    export POLL_URL="http://127.0.0.1:${port}/health"
    export POLL_TIMEOUT_SECS=30
    export POLL_INTERVAL_SECS=1
    run "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "exits 1 when timeout elapses without a 200" {
    echo "503" >"$TEST_TEMP_DIR/sequence.txt"
    port=$(start_sequenced_server)
    export POLL_URL="http://127.0.0.1:${port}/health"
    export POLL_TIMEOUT_SECS=3
    export POLL_INTERVAL_SECS=1
    run "$SCRIPT_PATH"
    [ "$status" -eq 1 ]
    [[ "$output" == *"timeout"* || "$output" == *"timed out"* ]]
}

@test "exits 1 when DNS / connection fails (server not listening)" {
    # Pick a port that is almost certainly closed.
    export POLL_URL="http://127.0.0.1:1/health"
    export POLL_TIMEOUT_SECS=3
    export POLL_INTERVAL_SECS=1
    run "$SCRIPT_PATH"
    [ "$status" -eq 1 ]
}

@test "exits 2 when POLL_URL is missing" {
    unset POLL_URL || true
    run "$SCRIPT_PATH"
    [ "$status" -eq 2 ]
    [[ "$output" == *"POLL_URL"* ]]
}

@test "exits 2 when POLL_URL is not http(s)" {
    export POLL_URL="file:///etc/passwd"
    run "$SCRIPT_PATH"
    [ "$status" -eq 2 ]
}
