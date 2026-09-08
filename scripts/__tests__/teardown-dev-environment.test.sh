#!/usr/bin/env bats
#
# BATS tests for teardown-dev-environment.sh
#
# Run with: npm run test:teardown-script
# Or directly: bats scripts/__tests__/teardown-dev-environment.test.sh
#
# A `docker` shim on PATH answers the script's liveness probe, so these
# exercise the real command the script builds without a daemon and without
# stopping anything. Every case runs --dry-run: the script prints the command
# it would issue, which is what these assert against.

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/teardown-dev-environment.sh"

setup() {
    TEST_TEMP_DIR="$(mktemp -d)"
    export WXYC_DEV_ROOT="$TEST_TEMP_DIR"

    # One Backend-Service checkout that named its own Compose project, so the
    # docker section has exactly one tree to act on.
    mkdir -p "$TEST_TEMP_DIR/Backend-Service/dev_env"
    touch "$TEST_TEMP_DIR/Backend-Service/dev_env/docker-compose.yml"
    printf 'COMPOSE_PROJECT_NAME=wxyc-backend-testtree\n' > "$TEST_TEMP_DIR/Backend-Service/.env"

    mkdir -p "$TEST_TEMP_DIR/bin"
    cat > "$TEST_TEMP_DIR/bin/docker" << 'SHIM'
#!/usr/bin/env bash
# `ps -q` is the script's liveness probe. Answer with one container id so it
# treats the stack as up and goes on to build the teardown command.
for arg in "$@"; do
    [[ "$arg" == "ps" ]] && echo "cafef00dcafe"
done
exit 0
SHIM
    chmod +x "$TEST_TEMP_DIR/bin/docker"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
}

teardown() {
    rm -rf "$TEST_TEMP_DIR"
}

@test "--help documents the volume flag" {
    run "$SCRIPT_PATH" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"--volumes"* ]]
}

@test "--volumes is a recognized option" {
    run "$SCRIPT_PATH" --dry-run --volumes
    [ "$status" -eq 0 ]
    [[ "$output" != *"Unknown option"* ]]
}

@test "unknown option still fails" {
    run "$SCRIPT_PATH" --not-an-option
    [ "$status" -eq 1 ]
    [[ "$output" == *"Unknown option"* ]]
}

@test "a dry run names the compose command it would run" {
    run "$SCRIPT_PATH" --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"docker compose"* ]]
    [[ "$output" == *"down"* ]]
}

@test "the default teardown keeps the seeded volume" {
    run "$SCRIPT_PATH" --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" != *"down -v"* ]]
    [[ "$output" != *"--volumes"*"--remove-orphans"* ]]
}

@test "--volumes opts into deleting it" {
    run "$SCRIPT_PATH" --dry-run --volumes
    [ "$status" -eq 0 ]
    [[ "$output" == *"down -v"* ]]
}

@test "teardown acts on each checkout's own Compose project" {
    run "$SCRIPT_PATH" --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"--env-file $WXYC_DEV_ROOT/Backend-Service/.env"* ]]
}
