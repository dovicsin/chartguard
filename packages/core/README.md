# @chartguard/core

Shared diagnostics, statuses and runtime contracts.

**Status:** see [`docs/00-status.md`](../../docs/00-status.md) and [`docs/03-packages.md`](../../docs/03-packages.md) for completed vs planned functionality.

Build: `npm run build -w @chartguard/core` (except CLI which is native ESM). Test: `npm run test -w @chartguard/core`.

Public API is declared in `src/index.ts` and exported via package `package.json`.

## Fixes

A `Diagnostic` may carry a `fix`. There are two kinds:

- **`rename-key`** preserves behaviour: the runtime already reads the option under its new name, so a tool may apply it.
- **`set-option`** changes what is drawn, as a quality finding asks. It names the option (`path`), the value it held when the finding was made (`from`; absent when unset), the new `value` and its `effect`. Apply it only at the user's request.

`applyFix(config, fix, path?)` returns a new config with the fix applied. `path` is the finding's path, needed for a rename.

- Only the objects on the path are copied; everything else is shared.
- The input is never written and no getter runs.
- It throws `FixError` when the fix no longer applies: the option changed since the finding, a getter, a primitive or a missing array element is on the way, or a renamed key's new name is taken.
