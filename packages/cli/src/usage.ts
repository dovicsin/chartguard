export const USAGE = `ChartGuard starter (partial schema coverage)
Usage:
  chartguard validate --library <chartjs|echarts|highcharts> --file config.json [--json]
  chartguard quality  --library <chartjs|echarts|highcharts> --file config.json [--json]
  chartguard analyze  --library <chartjs|echarts|highcharts> --file source.ts [--name config] [--json]
Exit codes: 0 no confirmed errors, 1 confirmed validation errors, 2 bad arguments or input, 3 internal failure.
NOTE: coverage=partial means clean output does not certify complete compatibility.`;
