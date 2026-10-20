#!/usr/bin/env bash
set -euo pipefail
plugin="$(cd "$(dirname "$0")/../.." && pwd)"
exec "$plugin/evals/_lib/fixture.sh" "$plugin" F16 --install
