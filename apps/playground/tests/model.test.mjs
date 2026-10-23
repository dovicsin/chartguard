import assert from 'node:assert/strict';
import test from 'node:test';

import { validate } from '@chartguard/config-chartjs';
import { analyze } from '@chartguard/quality-chartjs';

import { bySeverity, countBySeverity, inspect, lineAndColumn, schemaLabel } from '../dist/model.js';

const adapter = { validate, analyze };
const diagnostic = (severity, code) => ({ severity, code, path: '$', message: '', confidence: 'certain' });

test('a config is parsed, validated and reviewed; the tree locates its values', () => {
	const result = inspect('{"type":"bar","data":{"datasets":[]},"options":{"responsive":"yes"}}', adapter);
	assert.equal(result.kind, 'checked');
	assert.equal(result.validation.status, 'invalid');
	assert.deepEqual(
		result.validation.diagnostics.map((d) => d.path),
		['$.options.responsive']
	);
	assert.equal(result.quality.library, 'chartjs');
	assert.equal(result.tree.kind, 'object');
});

test('text that is not JSON is never validated or evaluated', () => {
	const calls = [];
	const spy = { validate: (config) => calls.push(config), analyze: (config) => calls.push(config) };
	assert.deepEqual(inspect('{"type": bar}', spy), {
		kind: 'syntax-error',
		message: 'Expected a JSON value',
		offset: 9
	});
	assert.deepEqual(inspect('globalThis.x = 1', spy).kind, 'syntax-error');
	assert.deepEqual(calls, []);
});

test('diagnostics are ordered by severity, keeping the validator order within one', () => {
	const list = [
		diagnostic('info', 'A'),
		diagnostic('error', 'B'),
		diagnostic('warning', 'C'),
		diagnostic('error', 'D')
	];
	assert.deepEqual(
		bySeverity(list).map((d) => d.code),
		['B', 'D', 'C', 'A']
	);
	assert.deepEqual(countBySeverity(list), { error: 2, warning: 1, info: 1 });
});

test('the schema label names the digest when there is one', () => {
	assert.equal(schemaLabel({ schemaVersion: '4.5.1' }), '4.5.1');
	assert.equal(
		schemaLabel({ schemaVersion: '4.5.1', schemaDigest: `sha256-${'a'.repeat(64)}` }),
		`4.5.1 · sha256-${'a'.repeat(12)}`
	);
});

test('offsets become 1-based lines and columns', () => {
	assert.deepEqual(lineAndColumn('ab\ncd', 0), { line: 1, column: 1 });
	assert.deepEqual(lineAndColumn('ab\ncd', 4), { line: 2, column: 2 });
});
