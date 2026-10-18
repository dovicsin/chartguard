# @chartguard/cli

Run `chartguard validate|quality|analyze --library <chartjs|echarts|highcharts> --file <path>`.

For source analysis, supply `--name <variable>` if the variable is not named `config`, `options`, or `chartConfig`.
`--json` emits structured diagnostics. Exit statuses: 0/no confirmed errors, 1/confirmed errors, 2/bad arguments or unusable input, 3/internal failure. Quality findings are advisory and always exit 0.
Partial coverage is explicitly disclosed.
