export const USAGE = `ChartGuard starter (partial schema coverage)
Usage:
  chartguard validate --library <chartjs|echarts|highcharts> --file config.json [--library-version <x|auto>] [--registries <file.json>] [--json]
  chartguard quality  --library <chartjs|echarts|highcharts> --file config.json [--json]
  chartguard analyze  --library <chartjs|echarts|highcharts> (--file source.ts ... | --project tsconfig.json) [--name config] [--project <tsconfig.json>] [--patterns <file.json>] [--library-version <x|auto>] [--registries <file.json>] [--json]
  chartguard schema build --library highcharts [--dir <project>] [--json]
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
schema build: generates the full Highcharts schema from your installed highcharts (it cannot ship with
  ChartGuard: license); validate and analyze then use it for that installed version.
Exit codes: 0 no confirmed errors, 1 confirmed validation errors, 2 bad arguments or input, 3 internal failure.
NOTE: coverage=partial means clean output does not certify complete compatibility.`;
