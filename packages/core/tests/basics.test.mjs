import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ConfigValidationError,
	createValidateBeforeCreate,
	isContainer,
	isRecord,
	ownDataProperty,
	result,
	suggestion
} from '../dist/index.js';

const error = (path) => ({ code: 'E', severity: 'error', message: 'x', path, confidence: 'certain' });
test('statuses reflect unknowns, coverage and confirmed errors', () => {
	assert.equal(result('x', '1', 'full', []).status, 'valid');
	assert.equal(result('x', '1', 'partial', []).status, 'partial');
	const unresolved = { code: 'ANY_CODE', severity: 'info', message: 'x', path: '$', confidence: 'unknown' };
	assert.equal(result('x', '1', 'full', [unresolved]).status, 'partial');
	// A likely problem from a schema fact that is not authoritative: not confirmed, not certified either (CG-02-07).
	const inferred = { code: 'ANY_CODE', severity: 'warning', message: 'x', path: '$', confidence: 'inferred' };
	assert.deepEqual(
		[result('x', '1', 'full', [inferred]).status, result('x', '1', 'full', [inferred]).valid],
		['partial', true]
	);
	const certainWarning = { ...inferred, confidence: 'certain' };
	assert.equal(result('x', '1', 'full', [certainWarning]).status, 'valid');
	assert.equal(
		result('x', '1', 'full', [{ code: 'E', severity: 'error', message: 'x', path: '$', confidence: 'certain' }]).status,
		'invalid'
	);
});
test('nearest known key suggestion', () =>
	assert.equal(suggestion('beginAtZerro', ['beginAtZero', 'display']), 'beginAtZero'));

test('no suggestion beyond typo distance', () => assert.equal(suggestion('legend', ['scales', 'plugins']), undefined));

test('pre-create guard blocks confirmed errors with a typed error carrying the full result', () => {
	const failing = () => result('demo', '1', 'full', [error('$.type')]);
	const guard = createValidateBeforeCreate('demo', failing);
	let created = false;
	assert.throws(
		() =>
			guard({}, () => {
				created = true;
			}),
		(thrown) =>
			thrown instanceof ConfigValidationError &&
			thrown.name === 'ConfigValidationError' &&
			thrown.message === 'demo config invalid: $.type' &&
			thrown.result.diagnostics[0].path === '$.type'
	);
	assert.equal(created, false);
});

test('pre-create guard reports and creates when nothing is confirmed wrong', () => {
	const reports = [];
	const guard = createValidateBeforeCreate('demo', () => result('demo', '1', 'partial', []));
	assert.equal(
		guard(
			{},
			() => 7,
			(validation) => reports.push(validation.status)
		),
		7
	);
	assert.deepEqual(reports, ['partial']);
});

test('own data reads never run getters', () => {
	let called = false;
	const target = {};
	Object.defineProperty(target, 'x', {
		get() {
			called = true;
			return 1;
		}
	});
	assert.deepEqual(ownDataProperty(target, 'x'), { found: false, accessor: true });
	assert.deepEqual(ownDataProperty({ x: 1 }, 'x'), { found: true, value: 1 });
	assert.deepEqual(ownDataProperty({}, 'x'), { found: false, accessor: false });
	assert.equal(called, false);
});

test('record and container guards', () => {
	assert.equal(isRecord([]), false);
	assert.equal(isRecord(null), false);
	assert.equal(isRecord({}), true);
	assert.equal(isContainer([]), true);
	assert.equal(isContainer('x'), false);
});
