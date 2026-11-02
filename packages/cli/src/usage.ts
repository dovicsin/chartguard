export const USAGE = `ChartGuard starter (partial schema coverage)
Usage:
  chartguard validate --library <chartjs|echarts|highcharts> --file <file|pattern> ... [--ignore <pattern>] [--library-version <x|auto>] [--registries <file.json>] [<output>]
  chartguard quality  --library <chartjs|echarts|highcharts> --file <file|pattern> ... [--ignore <pattern>] [--settings <file.json>] [<output>]
  chartguard analyze  --library <chartjs|echarts|highcharts> (--file <file|pattern> ... [--ignore <pattern>] | --project tsconfig.json) [--name config] [--project <tsconfig.json>] [--patterns <file.json>] [--library-version <x|auto>] [--registries <file.json>] [<output>]
  chartguard schema build --library highcharts [--dir <project>] [--json]
  chartguard --version | --help
<output>: [--format text|json|sarif | --json] [--fail-on error|warning|never]
Config: chartguard.config.json in the working directory, or --config <file>; --no-config reads none.
  Keys: library, files, ignore, format, failOn, libraryVersion, registries, settings, patterns, project,
  name, at the top level and in a "validate" / "quality" / "analyze" section; the command line wins,
  then the section, then the top level. Paths in the file are relative to it.
--file: a path, or a pattern relative to the working directory: * (within a directory), ** (any
  directories), ? (one character), {a,b}; never into node_modules or .git, never through links.
  Several files: text grouped by file, JSON { mode, files: [...] }, SARIF one log, the worst status;
  a file that cannot be read is listed and the others checked (exit 2). --ignore leaves files out.
--format: text (default), json (as --json), or sarif: one SARIF 2.1.0 log for code scanning, each
  finding at its file and the region of its value; paths relative to the working directory.
--fail-on: what exits 1: a confirmed error (error, the default), also any warning (warning), or
  nothing (never). quality is advisory: never by default, warning makes its warnings fail.
--library-version: the version you run; another minor/patch turns confirmed errors into warnings,
  another major is not validated. auto reads node_modules upward from the file.
--registries: what your runtime registered, { "<registry>": { "names": [...], "complete": true } }
  (echarts: "series.bar", "dataZoom.inside", "title"; chartjs.controllers/scales/plugins: "bar", "legend").
  complete: a tree-shaken build, anything else is rejected; false: extensions on top of the built-ins.
--project: the tsconfig whose compiler options analyze reads the files with; by default the nearest
  tsconfig.json upward from the first file. Without --file, every file the tsconfig includes is read.
  Several --file are read together, so each sees what the others change. No code runs.
analyze validates every config the file hands to the library (new Chart, setOption, Highcharts.chart,
  React wrappers); --name, or a file without such a call, selects variables by name instead.
--patterns: your own wrappers, [{ "id", "library", "module" | "file", "export", "argument" | "prop" }].
--settings: quality rule settings and the page the chart is shown on, { "rules": { "<rule id>": "off" | "info"
  | "warning" | { "level", "ignore": [{ "path", "reason" }] } }, "context": { "background": "#fff" | { "light",
  "dark" }, "describesData": true, "pausesMotion": true } }; suppressed findings are listed with why.
schema build: generates the full Highcharts schema from your installed highcharts (it cannot ship with
  ChartGuard: license); validate and analyze then use it for that installed version.
Exit codes: 0 nothing that fails (--fail-on), 1 findings that fail, 2 bad arguments or input, 3 internal failure.
  Exit 2 names the problem on stderr; with --json, stdout is { "error": { "kind": "usage" | "input", "message" } }.
  A scalar option given twice is an error, never the last one silently.
NOTE: coverage=partial means clean output does not certify complete compatibility.`;

/** Printed under a usage error instead of the whole usage. */
export const USAGE_HINT = "Run 'chartguard --help' for usage.";
