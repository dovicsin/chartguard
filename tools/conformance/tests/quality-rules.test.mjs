import assert from 'node:assert/strict';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';

import { analyze as analyzeChartjs } from '../../../packages/quality/chartjs/dist/index.js';
import { RULE_CATALOG } from '../../../packages/quality/core/dist/index.js';
import { RULES_CONTRACT } from '../../../packages/quality/core/tests/fixtures/rules-contract.mjs';
import { analyze as analyzeEcharts } from '../../../packages/quality/echarts/dist/index.js';
import { analyze as analyzeHighcharts } from '../../../packages/quality/highcharts/dist/index.js';
import { browserSkipReason } from '../../shared/chrome.mjs';
import { verdictOf } from '../lib/capture.mjs';
import { runChartjs } from '../lib/chartjs.mjs';
import { copyPlain } from '../lib/copy.mjs';
import { runEcharts } from '../lib/echarts.mjs';
import { runEchartsInBrowser } from '../lib/echarts-browser.mjs';
import { runHighcharts } from '../lib/highcharts.mjs';
import { builtChartjs, builtEcharts, builtHighcharts, PREMISES } from '../lib/quality-built.mjs';

/**
 * The rule catalog against the runtimes (CG-05-04): every contract chart renders on its pinned runtime,
 * each adapter reports exactly the contract's findings, and each finding's premise holds in what the
 * runtime built; where a rule is silent, its premise does not hold. A premise reads the runtime's own
 * model: the value axes the series are measured on, their range, scale and direction.
 */

const CODE_OF = new Map(RULE_CATALOG.map(({ id, code }) => [id, code]));

/**
 * Codes whose premise is not compared: the rule of an `unknown` case (the adapter claims nothing,
 * whatever is drawn), and rules the case's settings turn off (they do not run).
 */
function unclaimed(entry, options) {
	const off = Object.entries(options?.rules ?? {}).filter(
		([, setting]) => setting === 'off' || setting?.level === 'off'
	);
	return new Set(
		[...(entry.kind === 'unknown' ? [entry.rule] : []), ...off.map(([id]) => id)].map((id) => CODE_OF.get(id))
	);
}

/** Each premise holds exactly when its rule reported or suppressed a finding (a suppressed finding is still a claim). */
function checkPremises(entry, library, built) {
	const { findings, suppressed = [], options } = entry[library];
	const codes = new Set([...findings, ...suppressed].map((finding) => finding.split(' ')[0]));
	const skipped = unclaimed(entry, options);
	for (const [code, premise] of Object.entries(PREMISES)) {
		const holds = skipped.has(code) ? undefined : premise(built);
		if (holds !== undefined) assert.equal(holds, codes.has(code), `${entry.name}: ${code}`);
		// A context case is measured, unless its premise is the declaration itself (said why in `declaredOnly`).
		if (entry.kind === 'context' && code === CODE_OF.get(entry.rule) && entry[library].declaredOnly === undefined)
			assert.notEqual(holds, undefined, `${entry.name}: the premise of ${code} is not measured`);
	}
}

/** The adapter's report on a contract case: its findings, its suppressed findings, and the severity it set. */
function checkReport(entry, library, analyze) {
	const { config, options, findings, suppressed = [], severity } = entry[library];
	const report = analyze(config, options);
	const brief = ({ code, path }) => `${code} ${path}`;
	assert.deepEqual(report.diagnostics.map(brief), findings, entry.name);
	assert.deepEqual(
		report.suppressed.map(({ diagnostic }) => brief(diagnostic)),
		suppressed,
		entry.name
	);
	if (severity !== undefined)
		for (const { severity: reported } of report.diagnostics) assert.equal(reported, severity, entry.name);
}

const run = (config, render) => verdictOf(render(copyPlain(config)));

/** Whether a config survives JSON as it is (no functions): only those run in a browser page. */
const isJson = (value) => isDeepStrictEqual(JSON.parse(JSON.stringify(value)), copyPlain(value));

const browser = { skip: browserSkipReason() ?? false };
// What assistive technology gets from echarts needs a DOM: every echarts case that is plain JSON also runs in headless Chrome.
const echartsEntries = RULES_CONTRACT.filter((entry) => entry.echarts !== undefined && isJson(entry.echarts.config));
const echartsAccess =
	browser.skip === false
		? await runEchartsInBrowser(echartsEntries.map((entry) => copyPlain(entry.echarts.config)))
		: [];

for (const entry of RULES_CONTRACT) {
	if (entry.chartjs !== undefined)
		test(`quality rules, chartjs: ${entry.name}`, () => {
			const { config, options } = entry.chartjs;
			assert.equal(run(config, runChartjs), 'accepted');
			checkReport(entry, 'chartjs', analyzeChartjs);
			checkPremises(entry, 'chartjs', builtChartjs(config, options));
		});
	if (entry.echarts !== undefined)
		test(`quality rules, echarts: ${entry.name}`, () => {
			const { config, options } = entry.echarts;
			assert.equal(run(config, runEcharts), 'accepted');
			checkReport(entry, 'echarts', analyzeEcharts);
			const index = echartsEntries.indexOf(entry);
			checkPremises(entry, 'echarts', builtEcharts(config, index < 0 ? undefined : echartsAccess[index], options));
		});
}

const highcharts = RULES_CONTRACT.filter((entry) => entry.highcharts !== undefined);

test(
	'quality rules, highcharts: every contract chart renders, gets its findings, and their premises hold',
	browser,
	async () => {
		const outcomes = await runHighcharts(highcharts.map((entry) => ({ config: entry.highcharts.config })));
		highcharts.forEach((entry, index) => {
			const { config, options } = entry.highcharts;
			assert.equal(
				verdictOf(outcomes[index]),
				'accepted',
				`${entry.name}: ${JSON.stringify(outcomes[index].messages)}`
			);
			checkReport(entry, 'highcharts', analyzeHighcharts);
			checkPremises(entry, 'highcharts', builtHighcharts(outcomes[index].observed, config, options));
		});
	}
);
