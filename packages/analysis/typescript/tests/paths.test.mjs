import assert from 'node:assert/strict';
import test from 'node:test';

import { extractStaticConfigs, rangeAt } from '../dist/index.js';

const object = (source, name = 'config', filename = 'chart.ts') =>
	extractStaticConfigs(source, filename).objects.find((entry) => entry.name === name);
/** `path known|unknown[ reason] line:column-endLine:endColumn` for each fact. */
const facts = (entry) =>
	entry.paths.map(
		({ path, known, reason, line, column, endLine, endColumn }) =>
			`${path} ${known ? 'known' : 'unknown'}${reason === undefined ? '' : ` ${reason}`} ${line}:${column}-${endLine}:${endColumn}`
	);

test('every path of a value names the expression that wrote it', () => {
	const source = 'const config = {\n\ttype: "bar",\n\tdata: { datasets: [{ data: [1, 2] }] }\n};';
	assert.deepEqual(facts(object(source)), [
		'$ known 1:16-4:2',
		'$.type known 2:8-2:13',
		'$.data known 3:8-3:40',
		'$.data.datasets known 3:20-3:38',
		'$.data.datasets[0] known 3:21-3:37',
		'$.data.datasets[0].data known 3:29-3:35',
		'$.data.datasets[0].data[0] known 3:30-3:31',
		'$.data.datasets[0].data[1] known 3:33-3:34'
	]);
});

test('a value read through a name keeps the place where it is written: provenance, not the reference', () => {
	const source = 'const shared = { responsive: "yes" };\nconst config = { options: shared };';
	assert.deepEqual(facts(object(source)), [
		'$ known 2:16-2:35',
		'$.options known 1:16-1:37',
		'$.options.responsive known 1:30-1:35'
	]);
});

test('unknown paths say why: a call, a name, a computed key, a spread, a choice, a write, a cycle', () => {
	const source = [
		'const a = { v: 1 };',
		'const b = { v: 2 };',
		'const loop = { self: loop };',
		'const config = {',
		'\tcall: make(),',
		'\tname: param,',
		'\t[key]: 1,',
		'\tchoice: x ? a : b,',
		'\tlist: [1, dyn()],',
		'\tloop,',
		'\tlater: { k: 1 }',
		'};',
		'config.later.k = 2;'
	].join('\n');
	const unknown = object(source)
		.paths.filter((fact) => !fact.known)
		.map((fact) => `${fact.path} ${fact.reason} ${fact.line}`);
	assert.deepEqual(unknown, [
		'$ computed-key 7',
		'$.call call 5',
		'$.name name 6',
		'$.choice.v choice 8',
		'$.list[1] call 9',
		'$.loop.self cycle 3',
		'$.later.k mutated 13'
	]);
	const spread = object('const config = { a: 1, ...rest, b: 2 };');
	assert.deepEqual(
		spread.paths.filter((fact) => !fact.known).map((fact) => `${fact.path} ${fact.reason}`),
		['$ spread']
	);
});

test('a diagnostic path maps to the most specific known range at or above it', () => {
	const entry = object('const config = {\n\toptions: { responsive: "yes" }\n};');
	assert.deepEqual(rangeAt(entry.paths, '$.options.responsive'), {
		file: 'chart.ts',
		line: 2,
		column: 25,
		endLine: 2,
		endColumn: 30
	});
	// A missing key or an unknown one maps to the object that should hold it.
	assert.deepEqual(rangeAt(entry.paths, '$.options.missing'), {
		file: 'chart.ts',
		line: 2,
		column: 11,
		endLine: 2,
		endColumn: 32
	});
	// A sibling whose name only starts the same is not inside.
	assert.deepEqual(rangeAt(entry.paths, '$.optionsX').line, 1);
	assert.equal(rangeAt([], '$.a'), undefined);
});

test('uses carry path facts too, a react-chartjs-2 config included', () => {
	const [use] = extractStaticConfigs(
		'import { Bar } from "react-chartjs-2";\nconst v = <Bar data={{ datasets: [] }} />;',
		'chart.tsx'
	).uses;
	assert.deepEqual(
		use.paths.map((fact) => `${fact.path} ${fact.known ? 'known' : 'unknown'}`),
		['$ known', '$.type known', '$.data known', '$.data.datasets known']
	);
});
