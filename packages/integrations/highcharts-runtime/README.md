# @chartguard/runtime-highcharts

Safe paths for creating and changing Highcharts charts: options are checked for the Highcharts version that runs, and an update as `chart.update` applies it to this chart. Nothing is patched; call these instead of `Highcharts.chart`, `chart.update` and `chart.addSeries`.

```ts
import Highcharts from "highcharts";
import { createValidator } from "@chartguard/config-highcharts";
import { addSeries, createChart, update } from "@chartguard/runtime-highcharts";

// The full schema, generated locally from your installed highcharts (it is never shipped).
const validator = createValidator(artifact);
const { chart } = createChart(Highcharts, "container", options, { validator });
update(chart, { series: [{ data: next }] }, {}, { validator }); // checked as the series it changes
addSeries(chart, { data: [1, 2] }, {}, { validator });
```

- **Creation** validates with `libraryVersion: Highcharts.version` and remembers it for the chart's later calls. `factory: "stockChart" | "mapChart" | "ganttChart"` picks another constructor.
- **An update** is partial by design, so what it leaves out is not a finding. Each series item is matched as Highcharts matches it (by `id`, else by index; `index` chooses one) and checked as the type of the series it changes. An item that matches nothing is ignored by Highcharts unless you pass `oneToOne`; ChartGuard reports it as `CFG_INEFFECTIVE`. `checkUpdate` gives the same result without updating.
- **addSeries** checks the series with the chart type when it has none.
- **What is loaded**: every call reads the series types `Highcharts.seriesTypes` has at that moment. A series type whose module is not loaded (`sankey` without `modules/sankey`) is a confirmed `CFG_UNREGISTERED` error with the full schema (Highcharts would throw error #17). `registriesOf(Highcharts)` gives the same context for your own validation.
- **Reporting**: `onResult(result, { phase })` receives every result; without it, a result with confirmed errors is written with `console.warn`. **Blocking**: `{ block: true }` does not create, update or add with invalid options.
- Without `validator`, the shipped curated subset is used. It describes `13.x`, so for your exact version its errors are reported as warnings.

The options you pass are never changed and their getters are never run.
