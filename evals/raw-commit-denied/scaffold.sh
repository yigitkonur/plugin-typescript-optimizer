#!/usr/bin/env bash
# F01 with an open, locked run, wave 3 begun, and a hand edit of src/internal.ts on the work branch.
set -euo pipefail
plugin="$(cd "$(dirname "$0")/../.." && pwd)"
"$plugin/evals/_lib/fixture.sh" "$plugin" F01 --install
ts="$plugin/bin/ts-opt"
node "$ts" scan --quiet >/dev/null
node "$plugin/evals/_lib/confirm.mjs" "$plugin" reach-04 >/dev/null
node "$ts" run begin >/dev/null
node "$ts" plan check --rule reach-04 >/dev/null
node "$ts" plan lock >/dev/null
node "$ts" run wave begin 3 >/dev/null
sed -i.bak 's/export function normalize/function normalize/' src/internal.ts && rm -f src/internal.ts.bak
