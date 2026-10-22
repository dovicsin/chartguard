import assert from 'node:assert/strict';
import test from 'node:test';

import { review } from '../dist/index.js';

/** The accessibility rules (CG-05-04 part 5). */
const fact = (value, path, source = 'config') => ({
	known: true,
	value,
	path,
	source,
	...(source === 'default' ? { pointer: 'p' } : {})
});
const none = (path, reason = 'unmodelled') => ({ known: false, path, reason });
const chart = (dataDescribed, keyboard) => ({
	library: 't',
	title: { text: fact('T', '$.title'), shown: none('$.shown') },
	series: { known: true, path: '$.series', items: [] },
	axes: [],
	access: { dataDescribed, keyboard }
});
const codes = (semantics) => review(semantics).diagnostics.map((d) => `${d.code} ${d.path}`);

test('data not described: when it is known that assistive technology gets no description, also by default', () => {
	assert.deepEqual(codes(chart(fact(false, '$.aria.enabled', 'default'), none('$'))), [
		'VIS_DATA_NOT_DESCRIBED $.aria.enabled'
	]);
	assert.deepEqual(codes(chart(fact(true, '$.aria.label.enabled', 'default'), none('$'))), []);
	assert.deepEqual(codes(chart(none('$'), none('$'))), []);
});

test('keyboard disabled: only when the config turns it off', () => {
	assert.deepEqual(codes(chart(none('$'), fact(false, '$.accessibility.keyboardNavigation.enabled'))), [
		'VIS_KEYBOARD_DISABLED $.accessibility.keyboardNavigation.enabled'
	]);
	assert.deepEqual(codes(chart(none('$'), fact(false, '$.x', 'default'))), []);
	assert.deepEqual(codes(chart(none('$'), fact(true, '$.x'))), []);
});
