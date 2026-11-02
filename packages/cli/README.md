# @chartguard/cli

```sh
chartguard validate --library <chartjs|echarts|highcharts> --file 'charts/**/*.json' [--ignore '**/draft/**']
chartguard analyze  --library <chartjs|echarts|highcharts> --file chart.ts [--name <variable>] [--project <tsconfig.json>] [--patterns <file.json>]
chartguard quality  --library <chartjs|echarts|highcharts> --file config.json [--settings settings.json] [--ruleset misleads]
chartguard schema build --library highcharts [--dir <project>]
chartguard --version
chartguard --help
```

- `analyze` reads JavaScript/TypeScript without running it, with the nearest `tsconfig.json` (or the one `--project` names). It validates every config the file hands to the library: `new Chart(…)`, `setOption` on `echarts.init(…)`, `Highcharts.chart(…)` and the other factories, the React wrappers (react-chartjs-2, echarts-for-react, highcharts-react-official), followed through imports. `--patterns` adds your own wrappers (`[{ "id", "library", "module" | "file", "export", "argument" | "prop" }]`, `file` relative to the patterns file). With `--name`, or in a file without such a call, it validates the top-level `const` of that name (default `config` or `chartConfig`).
- Several `--file` are read together; `--project tsconfig.json` without `--file` reads every file it includes (a file that cannot be read is listed and skipped). Each finding names the exact source range of the value it is about (`file:line:column`; `endLine`/`endColumn` in `--json`).
- A config the code changes after declaring it (`config.options.color = …`, `push`, or passing it to another function) is validated without the changed parts and noted (`CFG_MUTATED`).
- `--library-version <x|auto>` validates against the version you run (`auto` reads `node_modules`, and without an install the version the nearest lockfile pins for the file's project: `package-lock.json`, `pnpm-lock.yaml` or `yarn.lock`; the report says which: `version <x> from <source>`; a lockfile that does not decide one exact version is an input error); `--registries <file.json>` says what your tree-shaken runtime registered.
- `--cache` (`validate`, `quality`) reuses a file's result when nothing it depends on changed: its text, the options and the files they name, the schema, and the ChartGuard code (by content). The output is the same as a run that computes it. Results are stored in `node_modules/.cache/chartguard/results` (or `--cache-location <dir>`); an entry that cannot be read is computed again, and a location that cannot be written is said once on stderr. `analyze` has no cache: its result depends on every file the TypeScript program reads.
- ChartGuard makes no network request and starts no process (a build check enforces it): there is no `--no-network`, because there is no other mode.
- `--plugin-schema <file.json>` (repeatable, `validate` and `analyze`) describes a plugin's options and variants as JSON, one extension or a list (`{ "id", "options": { "chartjs.plugins": { "datalabels": <schema> } }, "variants": { "echarts": { "series.wordCloud": <schema> } } }`, schemas as `@chartguard/config-core` writes them). Extensions add, never replace a built-in, and a name has one owner; a refused extension is an input error listing every problem. The result lists them (`extensions`, text `plugins:`). Highcharts takes them with the schema built from your install.
- `--file` may be given several times and may be a pattern, matched against paths relative to the working directory: `*` within a directory, `**` across directories, `?` one character, `{a,b}` alternatives; a `*` or `?` never matches a leading dot. A walk never enters `node_modules` or `.git` and never follows a link to a directory. `--ignore <pattern>` leaves files out. Files are read in code-unit order, each once. With several files (or any pattern) the text groups findings under `== <file>`, `--json` prints `{ "mode", "files": [ … ] }`, SARIF is one log, and the exit status is the worst; a file that cannot be read is listed with its reason, the others are checked, and the run exits 2. A pattern that matches nothing is an input error.
- A project config file, `chartguard.config.json` in the working directory (or the file `--config` names; `--no-config` reads none), holds the options a project always uses, as JSON: `library`, `files`, `ignore`, `format`, `failOn`, `libraryVersion`, `registries`, `pluginSchemas`, `cache`, `cacheLocation`, `settings`, `ruleset`, `patterns`, `project`, `name`, at the top level and in a `validate`, `quality` or `analyze` section for that command only. The command line wins, then the command's section, then the top level; a command-line value replaces the file's (`--file` replaces `files`). Paths and patterns in the file are relative to the file. A file with an unknown key or a wrong value is an input error listing every problem; the text report starts with `Settings from <file>.`, and a SARIF run names the file.

  ```json
  { "library": "echarts", "files": ["charts/**/*.json"], "ignore": ["**/draft/**"], "validate": { "format": "sarif", "failOn": "warning" } }
  ```
- `--format text|json|sarif` chooses the output (`--json` is `--format json`). `sarif` prints one SARIF 2.1.0 log for code scanning (GitHub and other SARIF consumers): each finding a result with its code as the rule, its file relative to the working directory and the region of the value it is about (in a JSON file found by its path; in source, the range that wrote it); a suppressed quality finding stays in the log as suppressed, with its reason; the run says which library, schema and coverage checked it.
- `--fail-on error|warning|never` decides what exits 1: a confirmed error (`error`, the default), also any warning (`warning`), or nothing (`never`). Quality findings are advisory: `quality` exits 0 unless you ask for `--fail-on warning`. Exit statuses: 0 nothing that fails, 1 findings that fail, 2 bad arguments or unusable input, 3 internal failure; `--fail-on` never changes 2 or 3.
- Exit 2 says what was wrong on stderr (`ChartGuard: <reason>`, then a pointer to `--help`; never the whole usage). With `--json` (before any `--`), stdout is also one JSON document: `{ "error": { "kind": "usage" | "input", "message": "…" } }` (`usage`: the arguments; `input`: a file that cannot be read or used). An option is accepted only by the commands it belongs to, and a single-valued option (`--library`, `--name`, `--json`, …) given twice is an error, never silently the last one; so is the same `--file` twice.
- `--version` prints the version of the CLI package and exits 0.
- Partial coverage is always disclosed: a clean result means no confirmed error was found, not that the configuration is complete.

## Highcharts

The full Highcharts schema cannot ship with ChartGuard (license). `chartguard schema build --library highcharts` generates it from the `highcharts` installed in your project and writes it to `node_modules/.cache/chartguard/`. `validate` and `analyze` then use it for exactly that installed version, and say so; without it, they validate with a small curated subset and tell you how to build the full schema.

## Quality settings

`quality --settings settings.json` reads rule levels, ignores and the page context. The format is in `@chartguard/quality-core`'s README.

Suppressed findings are printed as `SUPPRESSED (setting|context)` with their reason, and rules turned off as `OFF`; the JSON report has `suppressed` and `disabled`.

`--ruleset <rule|impact>` (repeatable) runs only the rules it names, by rule id or impact (`misleads`, `excludes`, `omits`, `risks`); the others are listed as `OFF`. It replaces a `ruleset` in the settings file, whose levels and ignores still apply to the selected rules.

A malformed settings file or `--ruleset` is an input error (exit 2) listing every problem.

## Fixes

A finding with a verified fix is followed by its edit:

- `FIX <path> = <value>: <effect>` for a quality fix, which changes the drawing;
- `FIX rename to <key>` for a deprecation the runtime renames itself.

The JSON report has the fix on the diagnostic. The CLI never writes your files.
