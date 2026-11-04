import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { audit } from '../../../tools/shared/axe.mjs';
import { browserSkipReason } from '../../../tools/shared/chrome.mjs';
import { skipOutsideCi } from '../../../tools/shared/ci.mjs';
import { shareFragment } from '../dist/share.js';
import { OUT } from '../scripts/build.mjs';

/**
 * The playground's accessibility (CG-07-04): axe-core finds no WCAG 2.2 A/AA violation nor best
 * practice in each state the page can be in, in the light and the dark scheme. The drawing frame is
 * an opaque origin axe does not enter; the chart in it is the user's config, reviewed by the quality
 * rules, not by this audit.
 */
const TWO_CHARTS = [
	"import { Chart } from 'chart.js';",
	"new Chart(document.createElement('canvas'), { type: 'bar', data: { datasets: [] }, options: { scales: { y: { min: 'x' } } } });",
	"new Chart(document.createElement('canvas'), { type: 'line', data: { datasets: [] } });"
].join('\n');

const STATES = [
	{ name: 'a valid example', hash: '', ready: '#summary:not(:empty)' },
	{
		name: 'a Chart.js example with findings',
		hash: '#chartjs:contract:radial-scale-type-typo',
		ready: '#diagnostics li'
	},
	{ name: 'an ECharts example with findings', hash: '#echarts:contract:axis-type-typo', ready: '#diagnostics li' },
	{
		name: 'JavaScript source with two charts (the chart picker and the run button)',
		hash: `#${String(shareFragment({ library: 'chartjs', mode: 'javascript' }, TWO_CHARTS))}`,
		ready: '#chart-field:not([hidden]) ~ #run:not([hidden])'
	},
	{ name: 'a shared link that cannot be read', hash: '#config=!!!', ready: '#notice:not(:empty)' }
];

const skip =
	// On CI a missing browser or bundle fails the gate instead of skipping it (E22).
	browserSkipReason() ?? (existsSync(join(OUT, 'main.js')) ? false : skipOutsideCi('needs a built playground'));

for (const colorScheme of ['light', 'dark'])
	for (const { name, hash, ready } of STATES)
		test(`${name}, ${colorScheme}: no accessibility violation`, { skip, timeout: 120_000 }, async () => {
			const violations = await audit(OUT, '/index.html', {
				hash,
				ready,
				colorScheme,
				// The drawing frame (an opaque origin) fetches its script with CORS, as on static hosts.
				headers: { 'access-control-allow-origin': '*' }
			});
			assert.deepEqual(violations, []);
		});
