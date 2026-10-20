# Rollback

Every wave is tagged `ts-optimize/<run>/wave-<id>-start` when `ts-opt run wave begin` runs.

| Situation | Command |
|---|---|
| One wrong finding | `ts-opt revert F-0007` (a `git revert` commit with a `Reverts:` trailer; the finding becomes `reverted`). |
| Gate red, culprit unknown | `ts-opt bisect --wave <W>` names the finding; then `ts-opt revert <F-id>`; then `ts-opt gate --wave <W>`. |
| The whole wave is bad, nothing pushed | Ask the user, then `git reset --hard ts-optimize/<run>/wave-<W>-start` (a human decision: the harness denies it for you). |
| The wave is already pushed | `ts-opt revert` each finding commit of the wave (never rewrite history). |
| Wave 5 (dependencies) | After reverting, reinstall with the package manager from `detect` so `node_modules` matches the lockfile again. |
| Give up on the run | `ts-opt run abort`: returns to the original branch, leaves `.ts-optimize/` and the work branch for inspection. |

A red gate is never bypassed by editing tsconfig, tests or suppressions. Restore, then re-triage the finding.
