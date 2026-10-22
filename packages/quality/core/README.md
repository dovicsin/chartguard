# @chartguard/quality-core

Library-neutral chart semantics and the advisory quality rules that read them. The adapters (`@chartguard/quality-chartjs`, `-echarts`, `-highcharts`) turn a config into `ChartSemantics`; `review(chart)` returns a `QualityReport`: findings only, never a verdict, never an error.

## Facts

Every fact is one of:

- **known from the config**, with the path it was read from;
- **the runtime's default**, with a pointer to the line of the pinned package that applies it;
- **unknown**, with its reason: `unset`, `accessor`, `dynamic`, `shape`, `unmodelled`, `inapplicable` or `layout` (it depends on the size the chart is drawn at).

Rules claim nothing on an unknown fact. Rules about an author's choice fire only on facts from the config.

## Rule catalog

`RULE_CATALOG` lists every rule with its rationale, its sources and its documented limits.

| Rule | Code | Severity | Reports |
| --- | --- | --- | --- |
| `bar-baseline` | `VIS_BAR_BASELINE` | warning | bars that do not grow from zero: a configured range that excludes it (a minimum above it, a maximum below it, or the data minimum), a range fitted to the data that leaves it out at every chart size (Chart.js `beginAtZero: false`, ECharts `scale: true`), or a base other than zero (Chart.js `base`, ECharts `startValue`, Highcharts `threshold`) |
| `bar-log-scale` | `VIS_BAR_LOG_SCALE` | warning | bars on a logarithmic value axis |
| `reversed-value-axis` | `VIS_REVERSED_VALUE_AXIS` | warning | a value axis the config reverses |
| `dual-axis` | `VIS_DUAL_AXIS` | info | series of one orientation measured on two value axes |
| `pie-negative` | `VIS_PIE_NEGATIVE` | warning | a negative value in a pie series (drawn as a positive slice or left out) |
| `same-color-series` | `VIS_SAME_COLOR_SERIES` | warning | two cartesian series drawn in the same colour (a repeated colour, Chart.js's default grey, a wrapped palette) |
| `low-contrast-series` | `VIS_LOW_CONTRAST_SERIES` | info | a cartesian series below 3:1 against a known background, in each colour scheme the chart can show |
| `placeholder-text` | `VIS_PLACEHOLDER_TEXT` | warning | a chart or value-axis title drawn with the library's placeholder text (Highcharts "Chart title", "Values") |
| `value-axis-untitled` | `VIS_VALUE_AXIS_UNTITLED` | info | a value axis whose title, and the chart's, are known to show nothing |
| `data-not-described` | `VIS_DATA_NOT_DESCRIBED` | warning | assistive technology gets no description of the data (ECharts without `aria`, Highcharts with accessibility off) |
| `keyboard-disabled` | `VIS_KEYBOARD_DISABLED` | warning | the config turns keyboard navigation off |
| `long-motion` | `VIS_LONG_MOTION` | warning | motion that starts by itself and runs forever (a looping animation, a ripple effect) or longer than five seconds |
| `empty-title` | `VIS_EMPTY_TITLE` | info | a title the config sets to blank text, unless it is known to be hidden |
| `percent-without-unit` | `VIS_PERCENT_WITHOUT_UNIT` | info | a percent-stacked value axis whose tick labels and title show no `%` |

Findings are advisory. A chart's purpose is not in its config, so every finding asks the reader to verify; each rule's `limits` say where it can be wrong.
