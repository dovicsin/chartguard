import assert from 'node:assert/strict';
import test from 'node:test';

import { validate } from '../dist/index.js';
import { KNOWN_VALID } from './fixtures/known-valid.mjs';
test('rejects nonobject root', () => assert.equal(validate(42).status, 'invalid'));

for (const [name, config] of Object.entries(KNOWN_VALID))
	test(`known-valid: ${name}`, () => {
		const result = validate(config);
		assert.equal(result.valid, true);
		assert.deepEqual(result.diagnostics, []);
	});

test('closed primitive fields are still confirmed errors', () => {
	const result = validate({ credits: { enabled: 'false' }, series: [{ name: 7 }] });
	assert.deepEqual(
		result.diagnostics.map((d) => `${d.code} ${d.path}`),
		['CFG_TYPE $.credits.enabled', 'CFG_TYPE $.series[0].name']
	);
});

test('schema version tracks the 13.x line', () => assert.match(validate({}).schemaVersion, /^13\.x/));
