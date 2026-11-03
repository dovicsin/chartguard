export const USAGE = `ChartGuard starter (partial schema coverage)
Usage:
  chartguard validate --library <chartjs|echarts|highcharts> --file <file|pattern> ... [--ignore <pattern>] [--library-version <x|auto>] [--registries <file.json>] [--plugin-schema <file.json>] ... [--cache [--cache-location <dir>]] [<output>]
  chartguard quality  --library <chartjs|echarts|highcharts> --file <file|pattern> ... [--ignore <pattern>] [--settings <file.json>] [--ruleset <rule|impact>] ... [--cache [--cache-location <dir>]] [<output>]
  chartguard analyze  --library <chartjs|echarts|highcharts> (--file <file|pattern> ... [--ignore <pattern>] | --project tsconfig.json) [--name config] [--project <tsconfig.json>] [--patterns <file.json>] [--library-version <x|auto>] [--registries <file.json>] [--plugin-schema <file.json>] ... [<output>]
  chartguard schema build --library highcharts [--dir <project>] [--json]
  chartguard --version | --help
<output>: [--format text|json|sarif|github | --json] [--fail-on error|warning|never]
Config: chartguard.config.json in the working directory, or --config <file>; --no-config reads none.
  Keys: library, files, ignore, format, failOn, libraryVersion, registries, settings, patterns, project,
  name, ruleset, pluginSchemas, cache, cacheLocation, at the top level and in a "validate" / "quality" / "analyze" section; the command line wins,
  then the section, then the top level. Paths in the file are relative to it.
--file: a path, or a pattern relative to the working directory: * (within a directory), ** (any
  directories), ? (one character), {a,b}; never into node_modules or .git, never through links.
  Several files: text grouped by file, JSON { mode, files: [...] }, SARIF one log, the worst status;
  a file that cannot be read is listed and the others checked (exit 2). --ignore leaves files out.
--format: text (default), json (as --json), sarif: one SARIF 2.1.0 log for code scanning, each
  finding at its file and the region of its value; or github: each finding a GitHub workflow command
  (an annotation on its line), then a summary line. Paths are relative to the working directory.
--fail-on: what exits 1: a confirmed error (error, the default), also any warning (warning), or
  nothing (never). quality is advisory: never by default, warning makes its warnings fail.
--library-version: the version you run; another minor/patch turns confirmed errors into warnings,
  another major is not validated. auto reads node_modules upward from the file; without an install,
  the nearest lockfile (package-lock.json, pnpm-lock.yaml, yarn.lock) for the file's project.
--registries: what your runtime registered, { "<registry>": { "names": [...], "complete": true } }
  (echarts: "series.bar", "dataZoom.inside", "title"; chartjs.controllers/scales/plugins: "bar", "legend").
  complete: a tree-shaken build, anything else is rejected; false: extensions on top of the built-ins.
--plugin-schema: a JSON file with a plugin's options and variants, one extension or a list:
  { "id", "options": { "<point>": { "<name>": <schema> } }, "variants": { "<point>": { "<name>": <schema> } } }
  (points: chartjs.plugins, chartjs.scales, echarts.options, echarts, highcharts.series; Chart.js
  "controllers"). Extensions add, never replace a built-in; a refused one is an input error. Highcharts
  needs the built schema.
--project: the tsconfig whose compiler options analyze reads the files with; by default the nearest
  tsconfig.json upward from the first file. Without --file, every file the tsconfig includes is read.
  Several --file are read together, so each sees what the others change. No code runs.
analyze validates every config the file hands to the library (new Chart, setOption, Highcharts.chart,
  React wrappers); --name, or a file without such a call, selects variables by name instead.
--patterns: your own wrappers, [{ "id", "library", "module" | "file", "export", "argument" | "prop" }].
--settings: quality rule settings and the page the chart is shown on, { "rules": { "<rule id>": "off" | "info"
  | "warning" | { "level", "ignore": [{ "path", "reason" }] } }, "context": { "background": "#fff" | { "light",
  "dark" }, "describesData": true, "pausesMotion": true } }; suppressed findings are listed with why.
--ruleset: only these quality rules run, by rule id or impact (misleads, excludes, omits, risks); the
  others are off and listed as OFF. Repeatable; replaces the settings file's "ruleset".
--cache: validate and quality reuse a file's result when nothing it depends on changed (its text, the
  options and files they name, the schema, the ChartGuard code); the output is the same. Stored in
  node_modules/.cache/chartguard/results, or --cache-location. analyze has no cache: its result depends
  on every file the TypeScript program reads.
schema build: generates the full Highcharts schema from your installed highcharts (it cannot ship with
  ChartGuard: license); validate and analyze then use it for that installed version.
Exit codes: 0 nothing that fails (--fail-on), 1 findings that fail, 2 bad arguments or input, 3 internal failure.
  Exit 2 names the problem on stderr; with --json, stdout is { "error": { "kind": "usage" | "input", "message" } }.
  A scalar option given twice is an error, never the last one silently.
ChartGuard makes no network request and starts no process: schemas ship with it or are built from
  your install, versions come from node_modules or the lockfile.
NOTE: coverage=partial means clean output does not certify complete compatibility.`;

/** Printed under a usage error instead of the whole usage. */
export const USAGE_HINT = "Run 'chartguard --help' for usage.";
