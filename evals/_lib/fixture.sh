#!/usr/bin/env bash
# Eval scaffold helper: materialise a test fixture into the (empty) eval workspace as a git repository.
#   fixture.sh <plugin-root> <F01|F10|F16|...> [--install]
# Runs as the operator under `claude plugin eval --scaffold` with a minimal environment (PATH, temp HOME).
set -euo pipefail
plugin="$1"; id="$2"; install="${3:-}"
src="$(ls -d "$plugin"/tests/fixtures/"$id"-* | head -n 1)"
cp -R "$src"/. .
rm -f SEEDS.json fixture.json
if [ "$install" = "--install" ] && [ -f package-lock.json ]; then npm ci --include=dev --ignore-scripts --no-audit --no-fund >/dev/null 2>&1; fi
printf 'node_modules\n.DS_Store\n' >> .gitignore
git init -q -b main
git config user.name eval
git config user.email eval@example.invalid
git config commit.gpgsign false
git add -A
git commit -q -m "fixture $id"
