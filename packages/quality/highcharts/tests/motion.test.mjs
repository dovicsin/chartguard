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

test('a series type that cannot be read leaves the options for its type unknown', () => {
	const hiddenType = (rest) => Object.defineProperty({ ...rest }, 'type', { get: () => 'column', enumerable: true });
	// plotOptions.line would apply only if the series were a line: which scope applies is not known.
	assert.equal(
		longest({ plotOptions: { line: { animation: { duration: 6000 } } }, series: [hiddenType({ data: [1] })] }),
		'? accessor $.series[0].type'
	);
	// The series' own option decides before its type's.
	assert.equal(
		longest({
			plotOptions: { line: { animation: { duration: 6000 } } },
			series: [hiddenType({ animation: false, data: [1] })]
		}),
		'0 config $.series[0].animation'
	);
	// A chart type behind a getter, likewise.
	const chart = Object.defineProperty({}, 'type', { get: () => 'column', enumerable: true });
	assert.equal(
		longest({ chart, plotOptions: { line: { animation: { duration: 6000 } } }, series: [{ data: [1] }] }),
		'? accessor $.chart.type'
	);
});
