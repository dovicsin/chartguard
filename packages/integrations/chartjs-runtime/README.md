# @chartguard/runtime-chartjs

Checks a Chart.js config when the chart is created and every time it is updated, through Chart.js's own plugin hooks. Opt-in per chart: nothing is registered globally and Chart.js is not patched.

```ts
import { Chart } from "chart.js";
import { guard } from "@chartguard/runtime-chartjs";

const chart = new Chart(canvas, guard(config));
chart.data.datasets[0].borderWidth = "wide";
chart.update(); // warns: $.data.datasets[0].borderWidth (Expected number, got string.)
```

- **Creation**: the config is checked as it was passed to `guard` (Chart.js writes default scales into it afterwards), against the running `Chart.version` unless you name one.
- **Updates**: the chart's own `type`, `data` and `options` are checked before each `update()`, except `options.scales`, which Chart.js merges with its defaults; the result notes this (`CFG_UNCHECKED`) and is `partial`.
- **What is registered**: each check reads what `Chart.registry` holds at that moment, plus the inline plugins of the config (`plugins: [Legend]`). On a tree-shaken Chart.js (`Chart.register(...)` instead of `chart.js/auto`), a controller or scale that is not registered is a confirmed `CFG_UNREGISTERED` error (Chart.js would throw), and an option of a plugin that is neither registered nor inline is `CFG_INEFFECTIVE`. `registriesOf(Chart, config.plugins)` gives the same context for your own validation.
- **Reporting**: `onResult(result, { phase, mode })` receives every result. Without it, a result with confirmed errors is written with `console.warn`; nothing else is logged.
- **Blocking**: `guard(config, { block: true })` does not draw an invalid config: Chart.js cancels that render or update and keeps what it drew before. Nothing is thrown inside Chart.js.
- `validator` replaces the shipped schema (for example `withExtensions([...])` from `@chartguard/config-chartjs`), `options` passes `registries` or `libraryVersion`, `updates: false` checks creation only.

`guard` never changes the config you pass and never runs its getters. To validate before construction and throw instead, use `validateBeforeCreate(config, (checked) => new Chart(canvas, checked))`.
