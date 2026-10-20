# @chartguard/analysis-typescript

Reads chart configuration objects from JavaScript and TypeScript source **without running any of it**: the file is parsed into a TypeScript Program and names are resolved through its TypeChecker. Partial by design: only top-level `const` objects are read; anything that depends on code (calls, imports, `let`, a `with` body, a function with direct `eval`) is left out and the object is marked incomplete.

```ts
import { extractStaticConfigs } from "@chartguard/analysis-typescript";
// One source text on its own: no file system, no lib. Runs anywhere.
const { objects, diagnostics } = extractStaticConfigs(source, "chart.ts");

import { analyzeProject } from "@chartguard/analysis-typescript/project";
// With the project's compiler options: the nearest tsconfig.json upward from the file,
// a named one ({ tsconfig: "tsconfig.app.json" }) or none ({ tsconfig: false }). Node only.
const analysis = analyzeProject(source, "/app/src/chart.ts");
analysis.tsconfig; // the tsconfig used, if any
```

`analyzeProject` throws `ProjectConfigError` for a tsconfig that cannot be read or has invalid options. Nothing is emitted, no tsconfig `include` pattern is expanded and no language-service plugin is loaded.

**Status:** see [`docs/00-status.md`](../../../docs/00-status.md) and [`docs/03-packages.md`](../../../docs/03-packages.md) for completed vs planned functionality.

Build: `npm run build -w @chartguard/analysis-typescript` (except CLI which is native ESM). Test: `npm run test -w @chartguard/analysis-typescript`.

Public API is declared in `src/index.ts` and exported via package `package.json`.
