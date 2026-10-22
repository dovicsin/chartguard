import assert from 'node:assert/strict';
import test from 'node:test';

import { normalize } from '../dist/index.js';

const brief = (fact) =>
	fact.known ? `${String(fact.value)} ${fact.source} ${fact.path}` : `? ${fact.reason} ${fact.path}`;
const longest = (config) => brief(normalize(config).motion.longest);

test('no built-in endless motion; series animations merged across scopes', () => {
	assert.equal(brief(normalize({ series: [{}] }).motion.endless), '? inapplicable $.series');
	assert.equal(longest({ series: [{}] }), '1000 default $.series[0].animation');
	assert.equal(longest({ series: [{ animation: true }] }), '500 default $.series[0].animation');
	assert.equal(longest({ series: [{ animation: false }] }), '0 config $.series[0].animation');
	assert.equal(
		longest({ plotOptions: { series: { animation: { duration: 8000 } } }, series: [{}, { animation: false }] }),
		'8000 config $.plotOptions.series.animation.duration'
	);
	// An object merges over the scopes below: over a duration it keeps it, over a boolean it has none (500 ms).
	assert.equal(
		longest({
			plotOptions: { column: { animation: { duration: 6000 } } },
			series: [{ type: 'column', animation: { defer: 1 } }]
		}),
		'6000 config $.plotOptions.column.animation.duration'
	);
	assert.equal(
		longest({ plotOptions: { series: { animation: false } }, series: [{ animation: { defer: 1 } }] }),
		'500 default $.series[0].animation.duration'
	);
	assert.equal(longest({ series: [] }), '0 config $.series');
});
