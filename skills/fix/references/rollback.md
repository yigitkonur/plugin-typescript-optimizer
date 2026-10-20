# Rollback

Every wave is tagged `ts-optimize/<run>/wave-<id>-start` when `ts-opt run wave begin` runs.

| Situation | Command |
|---|---|
| One wrong finding | `ts-opt revert F-0007` (a `git revert` commit with a `Reverts:` trailer; the finding becomes `reverted`). |
| Gate red, culprit unknown | `ts-opt bisect --wave <W>` names the finding; then `ts-opt revert <F-id>`; then `ts-opt gate --wave <W>`. |
| The whole wave is bad, nothing pushed | Ask the user to run `git reset --hard ts-optimize/<run>/wave-<W>-start` themselves (repeat passes: `…-start-p<N>`); you never run it yourself. |
| The wave is already pushed | `ts-opt revert` each finding commit of the wave (never rewrite history). |
| Wave 5 (dependencies) | After reverting, run `ts-opt pm install` so `node_modules` matches the lockfile again. |
| Give up on the run | `ts-opt run abort`: leaves `.ts-optimize/` for inspection; switches back to the default branch and removes the work branch only when the run created it and it holds no commits, otherwise stays on it. |

A red gate is never bypassed by editing tsconfig, tests or suppressions. Restore, then re-triage the finding.
