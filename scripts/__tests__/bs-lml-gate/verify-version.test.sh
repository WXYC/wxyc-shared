#!/usr/bin/env bats
#
# BATS tests for scripts/bs-lml-gate/verify-version.sh.
#
# Checks that a service's /version endpoint reports the SHA we expect.
# Used to detect "staging deployed an older build than the dispatcher's
# commit" — usually means a newer push has landed and we should wait
# for its dispatch to arrive instead of promoting against stale state.
#
# Env:
#   VERIFY_URL          — required
#   EXPECTED_SHA        — required (40-char hex)
#   VERIFY_JQ_PATH      — optional, default '.sha' (some services may use '.version' etc)
#
# Exit:
#   0 — match
#   1 — mismatch, non-200, or unparseable response
#   2 — usage error

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../../bs-lml-gate" && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/verify-version.sh"

EXPECTED='a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9'
OTHER='ffeeddccbbaa99887766554433221100ffeeddcc'

setup() {
    TEST_TEMP_DIR="$(mktemp -d)"
}

teardown() {
    # SERVER_PID lives in a file because start_version_server runs in
    # a $(...) subshell — plain variable assignment there would not
    # propagate.
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

# Start an HTTP server that returns the given (status, body) for /version.
# Status and body are passed via argv to keep the heredoc quoted (so Python's
# !r and bash's ${} can't collide).
start_version_server() {
    local status="$1" body="$2"
    local port_file="$TEST_TEMP_DIR/server.port"
    local body_file="$TEST_TEMP_DIR/server.body"
    printf '%s' "$body" >"$body_file"
    cat >"$TEST_TEMP_DIR/server.py" <<'PY_EOF'
import http.server, socketserver, sys
status = int(sys.argv[1])
with open(sys.argv[2], "rb") as f:
    body = f.read()
port_path = sys.argv[3]
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a, **k):
        pass
with socketserver.TCPServer(("127.0.0.1", 0), H) as s:
    with open(port_path, "w") as f:
        f.write(str(s.server_address[1]))
    s.serve_forever()
PY_EOF
    python3 "$TEST_TEMP_DIR/server.py" "$status" "$body_file" "$port_file" >/dev/null 2>&1 &
    echo $! >"$TEST_TEMP_DIR/server.pid"
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        if [[ -s "$port_file" ]]; then break; fi
        sleep 0.1
    done
    cat "$port_file"
}

@test "exit 0 when /version sha matches EXPECTED_SHA" {
    port=$(start_version_server 200 "{\"sha\":\"$EXPECTED\"}")
    export VERIFY_URL="http://127.0.0.1:${port}/version"
    export EXPECTED_SHA="$EXPECTED"
    run "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "exit 1 with both SHAs in stderr when /version sha mismatches" {
    port=$(start_version_server 200 "{\"sha\":\"$OTHER\"}")
    export VERIFY_URL="http://127.0.0.1:${port}/version"
    export EXPECTED_SHA="$EXPECTED"
    run "$SCRIPT_PATH"
    [ "$status" -eq 1 ]
    [[ "$output" == *"$EXPECTED"* ]]
    [[ "$output" == *"$OTHER"* ]]
}

@test "exit 1 on empty body" {
    port=$(start_version_server 200 '')
    export VERIFY_URL="http://127.0.0.1:${port}/version"
    export EXPECTED_SHA="$EXPECTED"
    run "$SCRIPT_PATH"
    [ "$status" -eq 1 ]
}

@test "exit 1 on non-200 response" {
    port=$(start_version_server 500 "{\"sha\":\"$EXPECTED\"}")
    export VERIFY_URL="http://127.0.0.1:${port}/version"
    export EXPECTED_SHA="$EXPECTED"
    run "$SCRIPT_PATH"
    [ "$status" -eq 1 ]
}

@test "exit 1 on unparseable JSON" {
    port=$(start_version_server 200 'not-json{')
    export VERIFY_URL="http://127.0.0.1:${port}/version"
    export EXPECTED_SHA="$EXPECTED"
    run "$SCRIPT_PATH"
    [ "$status" -eq 1 ]
}

@test "honours VERIFY_JQ_PATH override for services that nest the sha" {
    port=$(start_version_server 200 "{\"build\":{\"commit\":\"$EXPECTED\"}}")
    export VERIFY_URL="http://127.0.0.1:${port}/version"
    export EXPECTED_SHA="$EXPECTED"
    export VERIFY_JQ_PATH='.build.commit'
    run "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "exit 2 when VERIFY_URL or EXPECTED_SHA is missing" {
    unset VERIFY_URL EXPECTED_SHA || true
    run "$SCRIPT_PATH"
    [ "$status" -eq 2 ]
}
