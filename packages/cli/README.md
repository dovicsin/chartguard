# @chartguard/cli

```sh
chartguard validate --library <chartjs|echarts|highcharts> --file config.json
chartguard analyze  --library <chartjs|echarts|highcharts> --file chart.ts [--name <variable>]
chartguard quality  --library <chartjs|echarts|highcharts> --file config.json
chartguard schema build --library highcharts [--dir <project>]
```

- `analyze` reads JavaScript/TypeScript without running it. It validates the top-level `const` named `config` or `chartConfig`, or the one `--name` gives.
- `--library-version <x|auto>` validates against the version you run (`auto` reads `node_modules`); `--registries <file.json>` says what your tree-shaken runtime registered.
- `--json` emits structured output. Exit statuses: 0 no confirmed errors, 1 confirmed errors, 2 bad arguments or unusable input, 3 internal failure. Quality findings are advisory and always exit 0.
- Partial coverage is always disclosed: a clean result means no confirmed error was found, not that the configuration is complete.

## Highcharts

The full Highcharts schema cannot ship with ChartGuard (license). `chartguard schema build --library highcharts` generates it from the `highcharts` installed in your project and writes it to `node_modules/.cache/chartguard/`. `validate` and `analyze` then use it for exactly that installed version, and say so; without it, they validate with a small curated subset and tell you how to build the full schema.
