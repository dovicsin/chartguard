# @chartguard/quality-core

Library-neutral chart semantics and the advisory quality rules that read them. The adapters (`@chartguard/quality-chartjs`, `-echarts`, `-highcharts`) turn a config into `ChartSemantics`; `review(chart, options?)` returns a `QualityReport`: findings only, never a verdict, never an error.

## Facts

Every fact is one of:

- **known from the config**, with the path it was read from;
- **the runtime's default**, with a pointer to the line of the pinned package that applies it;
- **declared by the caller** (`context`), for a fact the chart leaves to the page;
- **unknown**, with its reason: `unset`, `accessor`, `dynamic`, `shape`, `unmodelled`, `inapplicable`, `layout` (it depends on the size the chart is drawn at) or `page` (the chart leaves it to the page it is shown in).

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

## Fixes

The adapters' `analyze` attaches a `set-option` fix to a finding only when the fix is trustworthy:

- **The config decides it:** the fix sets the option the finding names, to a value decided from what the option holds.
- **It is verified:** applied and reviewed again, the finding is gone and no new finding appears.

Each catalog entry's `fix` says which edit its rule offers, or why it offers none (the remedy needs the author's words, data or design choices).

| Rule | Fix |
| --- | --- |
| `bar-baseline` | the configured minimum, maximum or base to 0; `beginAtZero: true` (Chart.js), `scale: false` (ECharts) |
| `bar-log-scale` | the axis type to linear |
| `reversed-value-axis` | the reversal off |
| `percent-without-unit` | `labels.format: '{value}%'` where the axis has no format |
| `data-not-described` | ECharts `aria` on, Highcharts `accessibility.enabled` on (with the accessibility module) |
| `keyboard-disabled` | Highcharts keyboard navigation on |
| `long-motion` | a loop off, an ECharts ripple on hover only, a duration over five seconds to one second |

Before/after examples for every fixable rule are in `examples/quality-fixes`. Each is checked on the pinned runtimes: both versions render, `after` is the fix applied to `before`, and what the rule is about is drawn before and not after.

```json
{
	"code": "VIS_BAR_BASELINE",
	"path": "$.options.scales.y.min",
	"fix": {
		"kind": "set-option",
		"path": "$.options.scales.y.min",
		"from": 60,
		"value": 0,
		"effect": "The bars grow from zero again, so their lengths are proportional to their values."
	}
}
```

`withFixes(report, config, remedies, analyze)` is the machinery: an adapter's `remedies` propose, its `analyze` verifies.

## Settings and context

`review(chart, options)` and every adapter's `analyze(config, options)` take the caller's options:

```json
{
	"rules": {
		"value-axis-untitled": "off",
		"dual-axis": "warning",
		"bar-baseline": { "level": "info", "ignore": [{ "path": "$.options.scales.y", "reason": "A narrow band of stock prices." }] }
	},
	"context": { "background": { "light": "#ffffff", "dark": "#121212" }, "describesData": true, "pausesMotion": false }
}
```

Each rule's setting works as follows:

- **A level:** `off` (the rule does not run, and is listed in `disabled`), `info` or `warning`. Never `error`: quality never decides validity.
- **An ignore:** a finding at the path, or inside it, is not reported. Paths are compared segment by segment, and a reason is required.
- **Suppressed findings are kept** in `suppressed`, with why (`by: 'setting'` or `'context'`), never dropped.

The context declares what the config cannot show about the page:

- **`background`:** the page behind a chart that draws none (a Chart.js canvas, ECharts without `backgroundColor`, a transparent Highcharts background), so its series can be measured for contrast.
- **`describesData`:** `true` meets `data-not-described` (the page has a table or a text alternative). `false` lets the rule decide for a canvas.
- **`pausesMotion`:** `true` meets `long-motion` (WCAG 2.2.2).

Each catalog entry lists the context facts that change it (`context`).

Invalid options throw `QualityOptionsError`, listing every problem with where it is; `assertQualityOptions` checks them alone.

A rule's default severity follows its `impact`:

- `misleads` (every reader is shown the data wrongly) and `excludes` (some readers cannot get the content) are warnings;
- `omits` and `risks` are information.

Findings are advisory. A chart's purpose is not in its config, so every finding asks the reader to verify; each rule's `limits` say where it can be wrong.
