# @chartguard/eslint-plugin

Partial: three rules, one file at a time, not published yet (CG-06-03 parts 1–2). See `docs/14-roadmap.md` for what is still missing.

```js
// eslint.config.js
import chartguard from '@chartguard/eslint-plugin';

export default [
	chartguard.configs.recommended,
	{
		settings: {
			chartguard: {
				libraryVersion: { chartjs: 'auto' },
				extensions: { chartjs: [{ id: 'zoom', options: { 'chartjs.plugins': { zoom: { kind: 'object', properties: {} } } } }] },
				patterns: [{ id: 'acme.make-chart', library: 'chartjs', module: '@acme/charts', export: 'makeChart', argument: 0 }],
				quality: { rules: { 'value-axis-untitled': 'warning' } }
			}
		}
	}
];
```

- `chartguard/valid-config` (recommended: `error`) reports what the validator confirms is wrong.
- `chartguard/config-warnings` (recommended: `warn`) reports unknown keys (with a suggestion), deprecations, values without effect, unknown variants and version notes. `eslint --fix` applies the runtime's own renames (`clockWise` → `clockwise`), and only where nothing else can read the edited object: the key is written in the call that hands the config to the library, the config was read completely, and no other key of that name is set.
- `chartguard/chart-quality` (recommended: `warn`) reports the quality review's warnings for configs read completely: advisory, they depend on context. A verified edit (`min: 5` → `min: 0` for bars) is offered as a suggestion in the editor and never applied by `--fix`: it changes the drawing.
- Info findings are no claim and are never reported (quality rules can be raised to `warning` in `settings.chartguard.quality`).
- What is checked: the configs a file hands to Chart.js (`new Chart`), ECharts (`setOption` on `init`), Highcharts (`Highcharts.chart` and the other factories), the React wrappers (react-chartjs-2, echarts-for-react, highcharts-react-official), the ChartGuard runtime wrappers and the wrappers `patterns` names, found by where the callee is imported from (ES modules and `require`). A variable merely named `config` is not checked.
- Each finding stands at the range that wrote the value it is about. The file is read as ESLint holds it, by TypeScript, without running anything; a file TypeScript cannot parse (Flow, a Vue single-file component) yields nothing.
- One file at a time: an imported value is unknown, so a config built from one is validated as incomplete input, is never reported as missing a key, gets no quality review and no fix.
- Highcharts: a file is checked with the schema built for exactly the version its project installs (`chartguard schema build --library highcharts`), else with the curated subset (partial).
- `settings.chartguard`:
  - `libraryVersion`: exact versions by library, or `"auto"` for the version installed for the linted file (an uninstalled library a file uses stops the lint with the reason);
  - `registries`: what your tree-shaken runtime registered;
  - `extensions`: plugin schemas by library, as `--plugin-schema` takes them (Highcharts takes them with its built schema only);
  - `patterns`: your own wrappers (`module` a package name);
  - `quality`: rule levels, ignores, page context and ruleset, as `quality --settings` takes them.
  Settings that cannot be used stop ESLint with every problem listed.
- Not yet: a project mode that follows imports, `"auto"` from the lockfile when nothing is installed, publishing.
