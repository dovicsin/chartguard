import assert from 'node:assert/strict';
import test from 'node:test';

import { review } from '../dist/index.js';

/** The motion rule (CG-05-04 part 7). */
const fact = (value, path, source = 'config') => ({
	known: true,
	value,
	path,
	source,
	...(source === 'default' ? { pointer: 'p' } : {})
});
const none = (path, reason = 'unmodelled') => ({ known: false, path, reason });
const chart = (endless, longest) => ({
	library: 't',
	title: { text: fact('T', '$.title'), shown: none('$.shown') },
	series: { known: true, path: '$.series', items: [] },
	axes: [],
	background: none('$.background'),
	motion: { endless, longest },
	access: { dataDescribed: none('$.a'), keyboard: none('$.k') }
});
const codes = (semantics) => review(semantics).diagnostics.map((d) => `${d.code} ${d.path}`);

test('long motion: endless, else longer than five seconds; endless is reported once', () => {
	assert.deepEqual(codes(chart(fact(true, '$.loop', 'default'), fact(9000, '$.duration'))), ['VIS_LONG_MOTION $.loop']);
	assert.deepEqual(codes(chart(fact(false, '$.loop'), fact(5001, '$.duration'))), ['VIS_LONG_MOTION $.duration']);
	assert.deepEqual(codes(chart(fact(false, '$.loop'), fact(5000, '$.duration', 'default'))), []);
	assert.deepEqual(codes(chart(none('$.loop', 'inapplicable'), none('$.duration', 'dynamic'))), []);
	assert.match(review(chart(fact(false, '$.loop'), fact(6000, '$.d'))).diagnostics[0].message, /runs for 6 s/);
});
