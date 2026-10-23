# @chartguard/runtime-echarts

A safe `setOption` for Apache ECharts: the option is checked as the call will apply it to this chart, then set. Nothing is patched; call it instead of `chart.setOption`.

```ts
import * as echarts from "echarts";
import { setOption } from "@chartguard/runtime-echarts";

const chart = echarts.init(element);
setOption(chart, option, undefined, { options: { libraryVersion: echarts.version } });
setOption(chart, { series: [{ data: next }] }); // a merge update: checked against the series it merges into
```

- **A fresh option** (the chart has none yet, `notMerge`, or `replaceMerge` naming `series`) needs a `type` on every series: echarts drops one without it ("Unknown series"); ChartGuard reports `CFG_REQUIRED $.series[i].type`.
- **A merge update** may leave the type out: when its series name no `id` or `name`, each one is checked as the type of the series it merges into, matched by position as echarts matches it (an entry that is not an object takes no series), and one beyond the chart's series is reported (echarts drops it). A disposed chart sets nothing: nothing is claimed about what it would drop. What the chart holds is read once per call. What an update leaves out (the axes it does not repeat) is not a finding; a rule about it is reported as unresolved.
- `checkOption(chart, option, settings?)` gives the same result without setting anything.
- **What is registered**: pass the namespace you call `use` on (`{ echarts }`, from `echarts/core`). Each call then reads what it has registered: a series or component that is not registered is a confirmed `CFG_UNREGISTERED` error (echarts would drop it or throw). `registriesOf(echarts)` gives the same context for your own validation.
- **Reporting**: `onResult(result, { fresh })` receives every result; without it, a result with confirmed errors is written with `console.warn`. **Blocking**: `{ block: true }` does not set an invalid option.
- Pass `libraryVersion: echarts.version`: an ECharts instance does not say which version it is. `validator` replaces the shipped schema (for example `withExtensions([...])` from `@chartguard/config-echarts`).

The option you pass is never changed and its getters are never run.
