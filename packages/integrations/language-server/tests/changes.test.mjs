import assert from 'node:assert/strict';
import test from 'node:test';

import { changedText } from '../dist/changes.js';
import { Lines } from '../dist/positions.js';

/**
 * Content changes (CG-07-03): applied as LSP means them, each in the text the one before it left, and
 * in passes over the text that do not grow with the number of changes a client sends in the orders
 * clients send them (E73). Counted, never timed.
 */
const at = (line, character) => ({ line, character });
const change = (start, end, text) => ({ range: { start, end }, text });

/** The meaning: each change applied in turn to the text the one before it left. */
function sequential(text, changes) {
	let current = text;
	for (const { range, text: inserted } of changes) {
		if (range === undefined) {
			current = inserted;
			continue;
		}
		const lines = new Lines(current);
		const start = lines.offsetOf(range.start);
		const end = lines.offsetOf(range.end);
		if (end < start) return undefined;
		current = current.slice(0, start) + inserted + current.slice(end);
	}
	return current;
}

/**
 * Two large texts compared without handing them to an assertion: Node's assert diffs what it prints
 * of a failing value with work and memory that grow with its square (a 20,000-item list took over
 * 3 GB), so only where they first differ is shown.
 */
function sameText(actual, expected) {
	if (actual === expected) return;
	let index = 0;
	while (index < Math.min(actual.length, expected.length) && actual[index] === expected[index]) index++;
	assert.fail(
		`texts of ${String(actual.length)} and ${String(expected.length)} code units differ at ${String(index)}: ` +
			`${JSON.stringify(actual.slice(index, index + 40))} for ${JSON.stringify(expected.slice(index, index + 40))}`
	);
}

/** A small deterministic PRNG (mulberry32): `next()` is in [0, 1). */
function random(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Pieces that end lines in every way, join a CR with an LF across a change, and split a surrogate pair.
const PIECES = ['', 'a', 'bc', '\n', '\r', '\r\n', '\n\r', 'x\r', '\ny', '😀', ' '];

function randomChanges(next, count) {
	const pick = (list) => list[Math.floor(next() * list.length)];
	const position = () => at(Math.floor(next() * 5), Math.floor(next() * 5));
	return Array.from({ length: count }, () => {
		if (next() < 0.03) return { text: pick(PIECES) + pick(PIECES) };
		const [start, end] = [position(), position()].sort((a, b) => a.line - b.line || a.character - b.character);
		return change(start, next() < 0.05 ? at(start.line, 0) : end, pick(PIECES) + pick(PIECES));
	});
}

test('changes mean what they mean applied one by one: random batches, every terminator, joins across changes', () => {
	const cases = Number(process.env['FUZZ_CASES'] ?? 400) * 5;
	for (let seed = 1; seed <= cases; seed++) {
		const next = random(seed);
		const text = Array.from({ length: Math.floor(next() * 8) }, () => PIECES[Math.floor(next() * PIECES.length)]).join(
			''
		);
		const changes = randomChanges(next, 1 + Math.floor(next() * 6));
		const expected = sequential(text, changes);
		const actual = changedText(text, new Lines(text), changes);
		assert.equal(actual?.text, expected, `seed ${String(seed)}`);
		if (actual !== undefined) assert.deepEqual(actual.lines, new Lines(expected), `seed ${String(seed)}`);
	}
});

test('a CR and an LF joined across changes are one terminator: later positions are in the joined text', () => {
	const batches = [
		// Before: a deletion brings a CR next to the LF the change after it inserted.
		['a\rbc', [change(at(1, 1), at(1, 2), '\nX'), change(at(1, 0), at(1, 1), ''), change(at(1, 0), at(1, 0), 'Q')]],
		// After: an inserted CR meets the LF the text holds.
		['ab\ncd', [change(at(0, 1), at(0, 2), '\r'), change(at(1, 0), at(1, 0), 'Q')]],
		// After: an inserted LF follows the CR the text holds.
		['a\rbc', [change(at(1, 0), at(1, 1), '\nY'), change(at(1, 1), at(1, 1), 'Q')]]
	];
	for (const [text, changes] of batches)
		assert.equal(changedText(text, new Lines(text), changes)?.text, sequential(text, changes), JSON.stringify(text));
});

test('changes in the orders clients send them take one pass, however many (E73)', () => {
	const text = 'const a = { min: 1, max: 2 };\n'.repeat(20_000);
	const lines = new Lines(text);
	const replace = (line) => change(at(line, 17), at(line, 18), '9\n');
	// VS Code: a replace-all, last match first (each change before the one before it).
	const descending = Array.from({ length: 4000 }, (_, index) => replace(4000 - 1 - index));
	// Typing ahead in one batch (a client that waits for more): each change after the one before it.
	const ascending = Array.from({ length: 4000 }, (_, index) => replace(index * 2));
	// Both change the first 4000 lines of the text.
	const expected = text
		.split('\n')
		.map((line, index) => (index < 4000 ? line.replace('min: 1', 'min: 9\n') : line))
		.join('\n');
	for (const changes of [descending, ascending]) {
		const result = changedText(text, lines, changes);
		assert.equal(result?.passes, 1);
		sameText(result.text, expected);
	}
});

test('changes in no order take a pass each until their work is over its bound: then the text is unknown', () => {
	// Each change overlaps the one before it: it lies neither before nor after it.
	const overlapping = (count) => Array.from({ length: count }, () => change(at(0, 0), at(0, 2), 'zz'));
	const text = 'abc\n'.repeat(250_000);
	const lines = new Lines(text);
	const few = changedText(text, lines, overlapping(8));
	assert.equal(few?.passes, 8);
	sameText(few.text, `zz${text.slice(2)}`);
	// 16 passes over its own text and the texts it inserts, and a little more.
	assert.equal(changedText(text, lines, overlapping(17))?.passes, 17);
	assert.equal(changedText(text, lines, overlapping(18))?.passes, undefined);
	// A small text affords many passes.
	const small = 'abc\n'.repeat(10);
	assert.equal(changedText(small, new Lines(small), overlapping(4000))?.text, `zz${small.slice(2)}`);
});

test('a malformed change makes the whole batch unknown, wherever it is', () => {
	const text = 'ab\ncd';
	const lines = new Lines(text);
	const good = change(at(0, 0), at(0, 1), 'x');
	for (const bad of [
		change(at(1, 1), at(0, 0), 'x'),
		{ range: { start: at(0, 0) }, text: 'x' },
		change(at(-1, 0), at(0, 0), 'x'),
		change(at(0, 0.5), at(0, 1), 'x'),
		{ range: change(at(0, 0), at(0, 0), '').range },
		null
	])
		for (const changes of [[bad], [good, bad], [bad, good]]) assert.equal(changedText(text, lines, changes), undefined);
	assert.equal(changedText(text, lines, 'not a list'), undefined);
});
