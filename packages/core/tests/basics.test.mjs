import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ConfigValidationError,
	createValidateBeforeCreate,
	isContainer,
	isRecord,
	ownDataProperty,
	result,
	suggestion,
	suggestionBudget
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

/** The plain Levenshtein search the bounded one must agree with: the first closest candidate within a quarter of the input. */
function naiveSuggestion(input, candidates) {
	const distance = (a, b) => {
		const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array.from({ length: b.length }, () => 0)]);
		for (let k = 0; k <= b.length; k++) rows[0][k] = k;
		for (let i = 1; i <= a.length; i++)
			for (let k = 1; k <= b.length; k++)
				rows[i][k] = Math.min(
					rows[i - 1][k] + 1,
					rows[i][k - 1] + 1,
					rows[i - 1][k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1)
				);
		return rows[a.length][b.length];
	};
	let best;
	let bestDistance = Infinity;
	for (const candidate of candidates) {
		const found = distance(input, candidate);
		if (found < bestDistance) [best, bestDistance] = [candidate, found];
	}
	return bestDistance <= Math.max(1, Math.floor(input.length / 4)) ? best : undefined;
}

test('the bounded suggestion picks what the plain Levenshtein search picks (seeded)', () => {
	let state = 7;
	const next = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
	const word = () => Array.from({ length: 1 + Math.floor(next() * 14) }, () => 'abcd'[Math.floor(next() * 4)]).join('');
	const differences = [];
	for (let index = 0; index < 3000; index++) {
		const input = word();
		const candidates = Array.from({ length: Math.floor(next() * 8) }, word);
		const [found, expected] = [suggestion(input, candidates), naiveSuggestion(input, candidates)];
		if (found !== expected)
			differences.push(`${input} in ${candidates.join(',')}: ${String(found)} != ${String(expected)}`);
	}
	assert.deepEqual(differences.slice(0, 5), []);
});

test('a suggestion for an untrusted name is bounded: long names get none', () => {
	// Two long names the plain search compares cell by cell (8e8 cells, unlike none here).
	const budget = suggestionBudget();
	assert.equal(suggestion('a'.repeat(20_000), ['a'.repeat(19_999), 'b'.repeat(20_000)], budget), undefined);
	assert.equal(budget.cells, suggestionBudget().cells, 'no cell computed for a name over 100 characters');
	assert.equal(suggestion('x'.repeat(100), ['x'.repeat(99)]), 'x'.repeat(99));
	assert.equal(suggestion('x'.repeat(101), ['x'.repeat(100)]), undefined);
});

test('the work of suggestions stops at a run budget', () => {
	// A run's budget is spent by every call: once it is spent, no hint is searched for.
	const small = suggestionBudget(10_000);
	const candidates = Array.from({ length: 50 }, (_, index) => `option${String(index).padStart(3, '0')}`);
	assert.equal(suggestion('option01x', candidates, small), 'option010');
	assert.ok(small.cells < 10_000);
	// Counted, never timed: the calls a spent budget still answers (a bounded loop, so a defect fails, never hangs).
	let calls = 0;
	while (calls < 10 && suggestion('option01x', candidates, small) !== undefined) calls += 1;
	assert.ok(calls < 10, `hints after the budget: ${String(calls)}`);
	assert.ok(small.cells >= 0);
	assert.equal(suggestion('option01x', candidates), 'option010', 'without a run budget a call has its own');
});

test('the work of a suggestion is counted cell by cell', () => {
	// A candidate whose length alone rules it out costs nothing, and a distance stops at the first row
	// past the limit (two rows of four cells here).
	const counted = suggestionBudget(100);
	assert.equal(suggestion('abcd', ['abcdef'], counted), undefined);
	assert.equal(counted.cells, 100);
	assert.equal(suggestion('abcd', ['wxyz'], counted), undefined);
	assert.equal(counted.cells, 92);
});

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

test('a path reads back into the keys and indices keySegment wrote', async () => {
	const { keySegment, pathSegments } = await import('../dist/index.js');
	const keys = ['series', 0, 'label', 'a b', 'say "hi"', '0', '$ok'];
	const path = `$${keys.map((key) => (typeof key === 'number' ? `[${String(key)}]` : keySegment(key))).join('')}`;
	assert.equal(path, '$.series[0].label["a b"]["say \\"hi\\""]["0"].$ok');
	assert.deepEqual(pathSegments(path), keys);
	assert.deepEqual(pathSegments('$'), []);
	for (const malformed of ['series', '$.', '$[x]', '$.a..b', '$["unterminated]'])
		assert.equal(pathSegments(malformed), undefined, malformed);
});

test('only the one spelling keySegment writes is a path: never a thrown error, never a second name for a place (K15)', async () => {
	const { pathSegments } = await import('../dist/index.js');
	// An escape JSON does not know, or a raw control character: not a path, not a SyntaxError.
	for (const malformed of [String.raw`$["\x"]`, String.raw`$["\u12"]`, `$["a${'\u0001'}"]`])
		assert.equal(pathSegments(malformed), undefined, malformed);
	// `[01]` and `[1]` would name one place twice; so would `["a"]` and `.a`, or an escaped spelling.
	for (const second of ['$[01]', '$[00]', '$["a"]', String.raw`$["\u0061 b"]`, '$[9007199254740993]'])
		assert.equal(pathSegments(second), undefined, second);
	assert.deepEqual(pathSegments('$[0][10]["a b"]'), [0, 10, 'a b']);
	assert.deepEqual(pathSegments(String.raw`$["\u0001"]`), ['\u0001']);
});

test('the pre-create wrapper passes the caller options to the validator', () => {
	const seen = [];
	const guard = createValidateBeforeCreate('demo', (_config, options) => {
		seen.push(options);
		return result('demo', '1', 'partial', []);
	});
	guard({}, () => 'chart', undefined, { libraryVersion: '1.2.3' });
	guard({}, () => 'chart');
	assert.deepEqual(seen, [{ libraryVersion: '1.2.3' }, undefined]);
});
