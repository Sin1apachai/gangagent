#!/bin/sh
set -eu
cd "$(dirname "$0")"
cleanup() {
  docker compose -p agent-office-test -f compose.yaml -f compose.test.yaml --profile test down --volumes >/dev/null
}
trap cleanup EXIT INT TERM
docker compose -p agent-office-test -f compose.yaml -f compose.test.yaml --profile test up --build --abort-on-container-exit --exit-code-from tests
