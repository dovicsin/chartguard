import assert from 'node:assert/strict';
import test from 'node:test';

import { documented, REFERENCE_URL, referenceUrl, result } from '../dist/index.js';

/** Where findings are explained (CG-06-07): the published reference, by code, whatever the code. */
const finding = (code, extra = {}) => ({
	code,
	severity: 'warning',
	message: 'x',
	path: '$',
	confidence: 'certain',
	...extra
});

test('a code is explained at its anchor on the reference codes page', () => {
	assert.equal(REFERENCE_URL, 'https://dovicsin.github.io/chartguard/reference/');
	assert.equal(referenceUrl('CFG_TYPE'), `${REFERENCE_URL}codes.html#CFG_TYPE`);
	// A code is a fragment, never a path or a query: anything else is encoded.
	assert.equal(referenceUrl('A B/#?'), `${REFERENCE_URL}codes.html#A%20B%2F%23%3F`);
});

test('every finding of a result links to where it is explained; a page the adapter names is kept', () => {
	const own = 'https://echarts.apache.org/en/option.html#series-pie.clockwise';
	const checked = result('x', '1.0.0', 'full', [
		finding('CFG_TYPE'),
		finding('CFG_DEPRECATED', { documentationUrl: own })
	]);
	assert.deepEqual(
		checked.diagnostics.map(({ documentationUrl }) => documentationUrl),
		[referenceUrl('CFG_TYPE'), own]
	);
});

test('documenting is idempotent and leaves the finding it is given unchanged', () => {
	const original = finding('VIS_BAR_BASELINE');
	const once = documented(original);
	assert.equal('documentationUrl' in original, false);
	assert.deepEqual(documented(once), once);
	assert.equal(documented(once), once);
});
