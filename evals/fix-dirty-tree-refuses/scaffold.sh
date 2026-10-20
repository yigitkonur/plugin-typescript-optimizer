#!/usr/bin/env bash
# F01, audited (candidates left unjudged are deferred), then one uncommitted edit.
set -euo pipefail
plugin="$(cd "$(dirname "$0")/../.." && pwd)"
"$plugin/evals/_lib/fixture.sh" "$plugin" F01 --install
ts="$plugin/bin/ts-opt"
node "$ts" scan --quiet >/dev/null
node "$ts" verdict status --defer-missing --reason "eval scaffold" >/dev/null
node "$ts" findings ingest >/dev/null
printf '\n// local edit that is not committed\n' >> src/index.ts
