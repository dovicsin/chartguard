import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { keySegment, locateJsonPath, parseJsonSource } from '@chartguard/core';

import { main } from '../../../packages/cli/bin/chartguard.mjs';
import { corpus, random } from '../lib/hostile.mjs';

/**
 * JSON text from users (CG-07-02): the core reader accepts exactly what `JSON.parse` accepts (E40) on
 * mutated texts, places every value it reads, and the CLI keeps its exit codes and one JSON document
 * on stdout whatever the file holds. Seeded and bounded by a case count.
 */
const CASES = Number(process.env['FUZZ_CASES'] ?? 400) * 5;
/** What a mutation inserts: JSON's own tokens, the whitespace and escapes it refuses, and noise. */
const PIECES = [
	'{',
	'}',
	'[',
	']',
	',',
	':',
	'"',
	'\\',
	'\\u',
	'\\u00e9',
	'-',
	'0',
	'01',
	'1e',
	'.5',
	'e+',
	'true',
	'nul',
	' ',
	'\t',
	'\n',
	'\r',
	' ',
	'﻿',
	' ',
	'\u0000',
	'\u001f',
	'é',
	'😀',
	'\ud800'
];

const pick = (next, list) => list[Math.floor(next() * list.length)];

/** One to three edits of a JSON text: an insertion, a deletion or a duplicated slice. */
function mutate(text, next) {
	let result = text;
	const edits = 1 + Math.floor(next() * 3);
	for (let edit = 0; edit < edits; edit++) {
		const at = Math.floor(next() * (result.length + 1));
		const choice = next();
		if (choice < 0.5) result = `${result.slice(0, at)}${pick(next, PIECES)}${result.slice(at)}`;
		else if (choice < 0.8) result = `${result.slice(0, at)}${result.slice(at + 1 + Math.floor(next() * 3))}`;
		else result = `${result.slice(0, at)}${result.slice(at, at + 8)}${result.slice(at)}`;
	}
	return result;
}

const parses = (text) => {
	try {
		JSON.parse(text);
		return true;
	} catch {
		return false;
	}
};

/** The texts mutations start from: the JSON-safe fixture configs of every library, printed two ways. */
async function texts() {
	const configs = (await Promise.all(['chartjs', 'echarts', 'highcharts'].map(corpus))).flat();
	return configs.flatMap((config) => {
		try {
			const compact = JSON.stringify(config);
			return compact === undefined ? [] : [compact, JSON.stringify(config, null, 2)];
		} catch {
			return [];
		}
	});
}

/** Every path to a value of a parsed JSON value, in the notation findings use. */
function pathsOf(value, path = '$', found = []) {
	found.push(path);
	if (Array.isArray(value)) value.forEach((item, index) => pathsOf(item, `${path}[${String(index)}]`, found));
	else if (value !== null && typeof value === 'object')
		for (const key of Object.keys(value)) pathsOf(value[key], `${path}${keySegment(key)}`, found);
	return found;
}

test('the core JSON reader accepts exactly what JSON.parse accepts, and places every value it read (seeded)', async () => {
	const bases = await texts();
	assert.ok(bases.length > 20);
	const failures = [];
	for (let index = 0; index < CASES; index++) {
		const next = random(0x51ed27 + index);
		const text = mutate(pick(next, bases), next);
		const read = parseJsonSource(text);
		if (read.ok !== parses(text)) {
			failures.push(
				`case ${String(index)}: reader ${String(read.ok)}, JSON.parse ${String(!read.ok)}: ${JSON.stringify(text.slice(0, 80))}`
			);
			continue;
		}
		if (!read.ok) continue;
		for (const path of pathsOf(JSON.parse(text)).slice(0, 200))
			if (!locateJsonPath(read.root, path).exact) failures.push(`case ${String(index)}: ${path} not placed`);
	}
	assert.deepEqual(failures.slice(0, 10), []);
});

/** What is wrong with the CLI's run on one file: an exit code other than 0, 1, 2, or stdout that is not one JSON document. */
async function cliProblem(library, file) {
	const out = [];
	const code = await main(['validate', '--library', library, '--file', file, '--json'], {
		out: (line) => out.push(line),
		err: () => {}
	});
	const text = out.join('\n');
	try {
		JSON.parse(text);
	} catch {
		return `stdout is not one JSON document: ${JSON.stringify(text.slice(0, 120))}`;
	}
	return [0, 1, 2].includes(code) ? undefined : `exit ${String(code)}`;
}

test('the CLI on fuzzed files: exit 0, 1 or 2, never 3, and one JSON document on stdout (seeded)', async (t) => {
	const directory = mkdtempSync(join(tmpdir(), 'chartguard-fuzz-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const bases = await texts();
	const failures = [];
	for (let index = 0; index < 60; index++) {
		const next = random(0xc11 + index);
		const file = join(directory, `case-${String(index)}.json`);
		writeFileSync(file, next() < 0.2 ? pick(next, bases) : mutate(pick(next, bases), next));
		const library = pick(next, ['chartjs', 'echarts', 'highcharts']);
		const problem = await cliProblem(library, file);
		if (problem !== undefined) failures.push(`case ${String(index)} (${library}): ${problem}`);
	}
	assert.deepEqual(failures, []);
});
