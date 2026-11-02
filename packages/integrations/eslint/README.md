# @chartguard/eslint-plugin

Partial: two rules, no fixes yet, not published (CG-06-03 part 1). See `docs/14-roadmap.md` for what is still missing.

```js
// eslint.config.js
import chartguard from '@chartguard/eslint-plugin';

export default [
	chartguard.configs.recommended,
	{
		settings: {
			chartguard: {
				libraryVersion: { chartjs: '4.5.1' },
				extensions: { chartjs: [{ id: 'zoom', options: { 'chartjs.plugins': { zoom: { kind: 'object', properties: {} } } } }] },
				patterns: [{ id: 'acme.make-chart', library: 'chartjs', module: '@acme/charts', export: 'makeChart', argument: 0 }]
			}
		}
	}
];
```

- `chartguard/valid-config` (recommended: `error`) reports what the validator confirms is wrong; `chartguard/config-warnings` (recommended: `warn`) reports unknown keys (with a suggestion), deprecations, values without effect, unknown variants and version notes. Info findings are no claim and are never reported.
- What is checked: the configs a file hands to Chart.js (`new Chart`), ECharts (`setOption` on `init`), Highcharts (`Highcharts.chart` and the other factories), the React wrappers (react-chartjs-2, echarts-for-react, highcharts-react-official), the ChartGuard runtime wrappers and the wrappers `patterns` names, found by where the callee is imported from (ES modules and `require`). A variable merely named `config` is not checked.
- Each finding stands at the range that wrote the value it is about. The file is read as ESLint holds it, by TypeScript, without running anything; a file TypeScript cannot parse (Flow, a Vue single-file component) yields nothing.
- One file at a time: an imported value is unknown, so a config built from one is validated as incomplete input and is never reported as missing a key. Highcharts is checked with the curated subset (partial); the full schema built from your install (`chartguard schema build`) is the CLI's.
- `settings.chartguard`: `libraryVersion` (exact versions by library), `registries` (what your tree-shaken runtime registered), `extensions` (plugin schemas by library, as `--plugin-schema` takes them; Highcharts' curated subset has no extension points), `patterns` (your own wrappers, `module` a package name). Settings that cannot be used stop ESLint with every problem listed.
- Not yet: fixes, a project mode that follows imports, `libraryVersion: "auto"`, quality findings.
