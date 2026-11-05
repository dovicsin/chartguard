# @chartguard/analysis-typescript

Reads chart configuration objects from JavaScript and TypeScript source **without running any of it**: the file is parsed into a TypeScript Program and names are resolved through its TypeChecker. Partial by design: only top-level `const` values are read, also through imports and re-exports of the project's own files (`analyzeProject`; never `node_modules`, declaration files or files with syntax errors); a choice (`dark ? a : b`, `x ?? defaults`) gives its branch when the condition is known, otherwise only what both sides agree on; a simple builder (`function make(type) { const base = {…}; return {…}; }`) is read with its arguments, never run; a path the code writes (`config.options.color = …`, `config.data.datasets.push(…)`) is left out and noted (`CFG_MUTATED`); anything that depends on code (calls, `let`, object properties other than namespace members, a `with` body, a function with direct `eval`) is left out and the object is marked incomplete.

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

**Status:** pre-release (0.x). Coverage is partial, and the API and settings may still change between minor versions.

```sh
npm install --save-dev @chartguard/analysis-typescript
```

## Paths, several files, limits

Every object and use has `paths`: for each path of its value, the source range that wrote it (in whichever file) or why it is unknown (`call`, `name`, `spread`, `choice`, `mutated`, `cycle`, `limit`, …); `rangeAt(paths, "$.options.responsive")` gives the range a finding is about.

```ts
import { analyzeFiles, analyzeProjectFiles } from "@chartguard/analysis-typescript/project";
analyzeFiles([{ fileName, source }]);                 // several files read together: each sees the others' writes
await analyzeProjectFiles("tsconfig.json", { signal }); // every included file; cancellable
```

A file longer than `MAX_SOURCE_LENGTH` or nested deeper than `MAX_NESTING` is not read (`readable: false`, with a note); following references is bounded (`MAX_DECODE_STEPS`), values beyond it are `limit`.

A scan reads only files inside the tsconfig's directory (after following symbolic links): a link out of it, or an `include`/`files` entry outside it, is listed as not read (`CFG_OUTSIDE_PROJECT`); a file that cannot be read from disk is listed with its reason (`CFG_UNREADABLE`). `maxFiles` must be a non-negative integer, otherwise the scan throws `ScanOptionError`. A Program that cannot be built at all (a file nested too deeply for the parser) refuses every file (`CFG_TOO_COMPLEX`); nothing throws.

## Chart uses

`objects` lists the file's object constants; `uses` lists where the file hands a config to a chart library, recognized by where the callee comes from: `new Chart` (chart.js), `setOption` on `echarts.init(…)`, `Highcharts.chart` / `stockChart` / `mapChart` / `ganttChart`, the React wrappers react-chartjs-2, echarts-for-react and highcharts-react-official, and ChartGuard's `validateBeforeCreate`. Your own wrappers are added as patterns:

```ts
import { extractStaticConfigs } from "@chartguard/analysis-typescript";
extractStaticConfigs(source, "chart.tsx", {
  patterns: [{ id: "acme.render", library: "echarts", module: "@acme/charts", export: "render", argument: 1 }]
});
```

A pattern names a package (`module`) or a project file (`file`, absolute), a dotted `export`, and the config's `argument` index or JSX `prop`; malformed patterns throw `PatternError`. Passing an object to any other function counts as a possible change, except a few globals that only read (`console.*`, `JSON.stringify`, `structuredClone`, `Object.keys`, …), recognised as the global declared by the lib or `@types/node`, never by name: a local or script-level `console` may do anything. `import x = require('echarts')` is an origin, as `import * as x` is. A type-only import (`import type`, `import { type x }`, `export type { x }`) is erased at runtime, so its value is unknown. A literal `__proto__: …` sets the prototype, not a key: the object's inherited keys are unknown.

