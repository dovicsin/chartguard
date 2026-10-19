export const USAGE = `ChartGuard starter (partial schema coverage)
Usage:
  chartguard validate --library <chartjs|echarts|highcharts> --file config.json [--library-version <x|auto>] [--json]
  chartguard quality  --library <chartjs|echarts|highcharts> --file config.json [--json]
  chartguard analyze  --library <chartjs|echarts|highcharts> --file source.ts [--name config] [--library-version <x|auto>] [--json]
--library-version: the version you run; another minor/patch turns confirmed errors into warnings,
  another major is not validated. auto reads node_modules upward from the file.
Exit codes: 0 no confirmed errors, 1 confirmed validation errors, 2 bad arguments or input, 3 internal failure.
NOTE: coverage=partial means clean output does not certify complete compatibility.`;
