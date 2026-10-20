import assert from 'node:assert/strict';
import test from 'node:test';

import { extractStaticConfigs } from '../dist/index.js';

const codes = (output) => output.diagnostics.map((d) => d.code);

test('a file too large or nested too deeply is refused with a note, never a crash', () => {
	const large = extractStaticConfigs(`const config = { a: "${'x'.repeat(2_000_001)}" };`);
	assert.deepEqual([large.readable, codes(large), large.objects.length], [false, ['CFG_TOO_LARGE'], 0]);
	for (const shape of [
		(n) => `const config = ${'['.repeat(n)}${']'.repeat(n)};`,
		(n) => `const config = ${'{ a: '.repeat(n)}1${' }'.repeat(n)};`,
		(n) => `${'f('.repeat(n)}1${')'.repeat(n)};`
	]) {
		const deep = extractStaticConfigs(shape(5000));
		assert.deepEqual([deep.readable, codes(deep)], [false, ['CFG_TOO_COMPLEX']]);
		assert.equal(extractStaticConfigs(shape(200)).readable, true);
	}
	// JSX nesting is not counted as brackets; the stack overflow it causes is still caught.
	const jsx = extractStaticConfigs(`const v = ${'<b>'.repeat(5000)}${'</b>'.repeat(5000)};`, 'chart.tsx');
	assert.deepEqual([jsx.readable, codes(jsx)], [false, ['CFG_TOO_COMPLEX']]);
});

test('reading is bounded in total: choices that double per level stop at the work limit, quickly', () => {
	let source = 'const a0 = { v: 1 };\n';
	for (let level = 1; level <= 40; level++)
		source += `const a${String(level)} = x ? a${String(level - 1)} : a${String(level - 1)};\n`;
	source += 'const config = { v: a40 };';
	const started = performance.now();
	const output = extractStaticConfigs(source);
	assert.ok(performance.now() - started < 20_000, 'a hang guard, not a budget: the budget is counted in steps');
	assert.deepEqual(codes(output), ['CFG_TRUNCATED']);
	const config = output.objects.find((object) => object.name === 'config');
	assert.equal(config.complete, false);
	assert.ok(config.paths.some((fact) => fact.reason === 'limit'));
});

test('a value with more paths than the fact limit ends with a limit fact', () => {
	const source = `const config = { data: [${Array.from({ length: 12_000 }, (_, index) => String(index)).join(', ')}] };`;
	const [config] = extractStaticConfigs(source).objects;
	assert.equal(config.complete, true);
	assert.equal(config.value.data.length, 12_000);
	assert.equal(config.paths.length, 10_001);
	assert.deepEqual(config.paths.at(-1).reason, 'limit');
});

/** A small deterministic PRNG, so every run fuzzes the same inputs (mulberry32). */
function random(seed) {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
		mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
	};
}

const SEEDS = [
	'import { Chart } from "chart.js";\nconst base = { responsive: true };\nnew Chart(ctx, { type: "bar", options: { ...base }, data: { datasets: [{ data: [1, 2] }] } });',
	'const theme = { colors: ["red"] };\nfunction make(t = "line") { const o = { t }; return { type: t, theme, o }; }\nconst config = dark ? make() : make("bar");\nconfig.theme.colors.push("x");',
	'import * as echarts from "echarts";\nconst chart = echarts.init(el);\nconst option = { series: [{ type: "line", data: [1, , 3] }], ["k" + 1]: 2 };\nchart.setOption(option);',
	'import { Line } from "react-chartjs-2";\nconst view = <Line data={{ datasets: [] }} {...props} options={{ a: x ?? 1 }} />;'
];
const ALPHABET = '{}[](),;:.?!=<>/*+-"\'`$ \n\tabcxyz0123456789_' + 'ű\u0000 ';

/** Deletes, inserts or duplicates characters at random places. */
function mutate(source, next) {
	let text = source;
	const edits = 1 + Math.floor(next() * 6);
	for (let edit = 0; edit < edits; edit++) {
		const at = Math.floor(next() * (text.length + 1));
		const kind = next();
		if (kind < 0.4) text = text.slice(0, at) + text.slice(at + 1 + Math.floor(next() * 5));
		else if (kind < 0.8) text = text.slice(0, at) + ALPHABET[Math.floor(next() * ALPHABET.length)] + text.slice(at);
		else text = text.slice(0, at) + text.slice(at, at + 20).repeat(2) + text.slice(at + 20);
	}
	return text;
}

test('fuzzed sources never throw, never invent a value, and stay serializable (seeded, 2000 cases)', () => {
	const next = random(20_261_020);
	for (let index = 0; index < 2000; index++) {
		const seed = SEEDS[index % SEEDS.length];
		const source = mutate(seed, next);
		const filename = seed.includes('<') ? 'f.tsx' : 'f.ts';
		let output;
		assert.doesNotThrow(() => {
			output = extractStaticConfigs(source, filename);
		}, JSON.stringify(source));
		assert.doesNotThrow(() => JSON.stringify(output), JSON.stringify(source));
		for (const entry of [...output.objects, ...output.uses]) {
			// A complete value has no unknown path; an unreadable file has nothing complete.
			if (entry.complete)
				assert.ok(
					entry.paths.every((fact) => fact.known),
					JSON.stringify(source)
				);
			if (!output.readable) assert.equal(entry.complete, false, JSON.stringify(source));
		}
	}
});
