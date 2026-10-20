# @chartguard/cli

```sh
chartguard validate --library <chartjs|echarts|highcharts> --file config.json
chartguard analyze  --library <chartjs|echarts|highcharts> --file chart.ts [--name <variable>] [--project <tsconfig.json>] [--patterns <file.json>]
chartguard quality  --library <chartjs|echarts|highcharts> --file config.json
chartguard schema build --library highcharts [--dir <project>]
```

- `analyze` reads JavaScript/TypeScript without running it, with the nearest `tsconfig.json` (or the one `--project` names). It validates every config the file hands to the library: `new Chart(…)`, `setOption` on `echarts.init(…)`, `Highcharts.chart(…)` and the other factories, the React wrappers (react-chartjs-2, echarts-for-react, highcharts-react-official), followed through imports. `--patterns` adds your own wrappers (`[{ "id", "library", "module" | "file", "export", "argument" | "prop" }]`, `file` relative to the patterns file). With `--name`, or in a file without such a call, it validates the top-level `const` of that name (default `config` or `chartConfig`).
- Several `--file` are read together; `--project tsconfig.json` without `--file` reads every file it includes (a file that cannot be read is listed and skipped). Each finding names the exact source range of the value it is about (`file:line:column`; `endLine`/`endColumn` in `--json`).
- A config the code changes after declaring it (`config.options.color = …`, `push`, or passing it to another function) is validated without the changed parts and noted (`CFG_MUTATED`).
- `--library-version <x|auto>` validates against the version you run (`auto` reads `node_modules`); `--registries <file.json>` says what your tree-shaken runtime registered.
- `--json` emits structured output. Exit statuses: 0 no confirmed errors, 1 confirmed errors, 2 bad arguments or unusable input, 3 internal failure. Quality findings are advisory and always exit 0.
- Partial coverage is always disclosed: a clean result means no confirmed error was found, not that the configuration is complete.

## Highcharts

The full Highcharts schema cannot ship with ChartGuard (license). `chartguard schema build --library highcharts` generates it from the `highcharts` installed in your project and writes it to `node_modules/.cache/chartguard/`. `validate` and `analyze` then use it for exactly that installed version, and say so; without it, they validate with a small curated subset and tell you how to build the full schema.
