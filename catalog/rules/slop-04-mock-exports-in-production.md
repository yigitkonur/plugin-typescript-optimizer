---
schema: ts-optimize/rule@1
id: slop-04
version: 1
name: Mock and test-utility exports in production files
domain: slop
batch: null
wave: "R"
severity: warn
fix_risk: low
fix_mode: assisted
grain: symbol
triage: agent
semantic_invariance: true
modes: [standard, deep]
engines: [R]
requires: {}
tells:
  - {id: t1, regex: '^[ \t]*export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|abstract\s+class|type|interface|enum)\s+(?:(?:[Mm]ock|[Ff]ixture|[Dd]ummy|[Ff]ake|[Ss]tub|createMock|createFake|createStub|testHelper)(?:[A-Z_$0-9][\w$]*)?|[a-z][\w$]*(?:Mock|Fixture|Stub|Fake)s?)\b', flags: 'm', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.ts', '**/generated/**', '**/*.{test,spec,stories}.*', '**/{test,tests,__tests__,__mocks__,__fixtures__,fixtures,e2e}/**', '**/*{test-utils,testUtils,test-helpers,testHelpers,test-setup}.*']}
primary_over: []
sources: ['CAT Pattern 5', 'STR Tenet 2 (Interface as Test Surface)', 'doc 06 §10 (seam with reach-03)']
---
## What
A production source file exports a name that says it is a test double: `mockUser`, `createMockOrder`, `FakeClock`, `userFixture`, `dummyData`, `stubFetch`, `MockContext`. It bleeds test infrastructure into the production bundle and bloats the public API surface. The tell matches declaration forms (`export const|function|class|type|interface|enum`) with a test-double prefix (`mock`, `fixture`, `dummy`, `fake`, `stub`, `createMock…`, `testHelper`, followed by an uppercase letter or end of name) or a `…Mock`/`…Fixture`/`…Stub`/`…Fake` suffix; `mockingbird`, `stubborn` and `fakeroot` do not match. Test files are excluded by glob (`*.test.*`, `*.spec.*`, `*.stories.*`, test directories, `*test-utils*`), not by a substring test on the path: `latest-prices.ts` is a production file and is scanned.

## Triage
Keep (false positive) when:
- The "mock" is real production behavior: a demo/offline mode, a dev-only MSW worker wired into the app, a sandbox adapter shipped to users. Check for non-test importers.
- The export is a legitimate public testing entry of a library (`my-lib/testing`) listed in `package.json#exports`.
- The path is test infrastructure the globs miss (a custom `testing/` folder): reclassify, do not edit.
Seam: when the same location is also reported by reach-03 (the symbol is used only by non-production files), **reach-03 is primary** and this finding is superseded; the fix is the same relocation.

## Proposed change
Relocate `{{symbol}}` out of `{{file}}`:
1. If only tests use it (`{{consumers}}`): move it to a test-side location (`test/helpers/`, `src/__mocks__/`, or inside the `*.test.ts` that uses it) and retarget the tests at the public interface where possible ("Replace, don't layer": no compatibility re-export left behind).
2. **Strip `export`** from the production file when nothing outside still needs the symbol.
```diff
-export const mockUser = { id: 1, name: 'Ada' };
+// moved to test/helpers/users.ts
```
3. Update test import paths in the same commit. Use `git mv` for whole files. Files: {{touches}} (at most 5).

## Verification
Wave R legs: typecheck, test, build. Semantic-invariance commit checks apply (doc 06 §6): no test assertion line changed (import paths only), no added control flow, at most 5 files, `exports`-map check across package boundaries. A production build that now fails to resolve the symbol means a non-test consumer exists: restore and re-triage.

## Pitfalls
- A mock exported "for tests" that a story or e2e config also imports counts as a test consumer; check `.stories.*` and `playwright`/`cypress` configs.
- Removing the export leaves a dead local; the bridge wave handles `TS6133` residue, do not suppress it.
- The tell does not see `export { mockFoo }` lists or default-exported objects; reach-03 will catch those through Knip.
- Fixtures under `fixtures/` directories are excluded as test infrastructure; a production folder with that name must be added to the scan scope by the user.
