import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { PatternError } from '../dist/index.js';
import { analyzeProject, openSession, ProjectConfigError } from '../dist/project.js';

/**
 * A project session (CG-06-04): one project read again and again as files change, the Program and
 * every unchanged file reused, with exactly the results a fresh analysis gives.
 */
const json = (value) => JSON.parse(JSON.stringify(value ?? null));
const summary = (analysis) => ({
	readable: analysis.readable,
	uses: analysis.uses.map((use) => ({
		pattern: use.pattern,
		value: json(use.value),
		complete: use.complete,
		paths: use.paths
	})),
	diagnostics: analysis.diagnostics
});

function project(t, files) {
	const root = mkdtempSync(join(tmpdir(), 'chartguard-session-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	for (const [name, text] of Object.entries({ 'tsconfig.json': '{}', ...files })) {
		mkdirSync(join(root, name, '..'), { recursive: true });
		writeFileSync(join(root, name), text);
	}
	return root;
}

const CHART = 'import { Chart } from "chart.js";\nimport { options } from "./options";\n';

test('a session reads what a fresh analysis reads, through imports, for an editor buffer that is not on disk', (t) => {
	const root = project(t, { 'src/options.ts': 'export const options = { responsive: "yes" };' });
	const fileName = join(root, 'src/chart.ts');
	const source = `${CHART}new Chart(ctx, { type: "bar", data: { datasets: [] }, options });`;
	const session = openSession(fileName);
	assert.equal(session.tsconfig, join(root, 'tsconfig.json'));
	const read = session.analyze(fileName, source);
	assert.deepEqual(summary(read), summary(analyzeProject(source, fileName)));
	assert.deepEqual(json(read.uses[0].value), { type: 'bar', data: { datasets: [] }, options: { responsive: 'yes' } });
	assert.equal(
		read.uses[0].paths.find(({ path }) => path === '$.options.responsive').file,
		join(root, 'src/options.ts')
	);
	assert.equal(read.fileName, fileName);
});

test('a changed buffer and a file changed on disk are read again; nothing else is', (t) => {
	const root = project(t, { 'src/options.ts': 'export const options = { responsive: "yes" };' });
	const fileName = join(root, 'src/chart.ts');
	const session = openSession(fileName);
	const value = (source) => json(session.analyze(fileName, source).uses[0]?.value);
	assert.deepEqual(value(`${CHART}new Chart(ctx, { type: "bar", options });`), {
		type: 'bar',
		options: { responsive: 'yes' }
	});
	assert.deepEqual(value(`${CHART}new Chart(ctx, { type: "line", options });`), {
		type: 'line',
		options: { responsive: 'yes' }
	});
	const options = join(root, 'src/options.ts');
	writeFileSync(options, 'export const options = { responsive: false };');
	// Another time and size on disk: read again.
	const later = new Date(statSync(options).mtimeMs + 5_000);
	utimesSync(options, later, later);
	assert.deepEqual(value(`${CHART}new Chart(ctx, { type: "line", options });`), {
		type: 'line',
		options: { responsive: false }
	});
});

test('a session reuses its Program: a second reading is a fraction of the first', (t) => {
	const root = project(t, { 'src/options.ts': 'export const options = { responsive: true };' });
	const fileName = join(root, 'src/chart.ts');
	const session = openSession(fileName);
	const time = (source) => {
		const start = performance.now();
		session.analyze(fileName, source);
		return performance.now() - start;
	};
	const first = time(`${CHART}new Chart(ctx, { type: "bar", options });`);
	const again = Math.min(
		...[1, 2, 3].map((n) => time(`${CHART}new Chart(ctx, { type: "bar", options, n: ${String(n)} });`))
	);
	assert.ok(again * 3 < first, `first ${first.toFixed(0)} ms, again ${again.toFixed(0)} ms`);
});

test('the bounds hold in a session: a text too large is refused, a file with syntax errors yields nothing', (t) => {
	const root = project(t, {});
	const fileName = join(root, 'src/chart.ts');
	const session = openSession(fileName);
	const large = session.analyze(fileName, `const a = ${'1+'.repeat(1_100_000)}1;`);
	assert.deepEqual([large.readable, large.diagnostics.map(({ code }) => code)], [false, ['CFG_TOO_LARGE']]);
	// A file with syntax errors is read as a fresh analysis reads it: unreadable, its uses incomplete.
	const brokenText = `${CHART}new Chart(ctx, { type: "bar" `;
	const broken = session.analyze(fileName, brokenText);
	assert.equal(broken.readable, false);
	assert.deepEqual(summary(broken), summary(analyzeProject(brokenText, fileName)));
	// And the session still reads the next text.
	assert.equal(session.analyze(fileName, `${CHART}new Chart(ctx, { type: "bar" });`).uses.length, 1);
});

test('opening a session: the nearest tsconfig, a named one, none; an unusable one is ProjectConfigError', (t) => {
	const root = project(t, { 'other.json': '{ "compilerOptions": { "strict": true } }', 'bad.json': '{ nope' });
	const fileName = join(root, 'src/chart.ts');
	assert.equal(openSession(fileName, { tsconfig: join(root, 'other.json') }).tsconfig, join(root, 'other.json'));
	assert.equal(openSession(fileName, { tsconfig: false }).tsconfig, undefined);
	assert.throws(() => openSession(fileName, { tsconfig: join(root, 'bad.json') }), ProjectConfigError);
	assert.throws(() => openSession(fileName, { patterns: [{ id: 'p' }] }), PatternError);
});

test('an imported file nested too deeply to build the Program is a refusal in a session, never a throw (E31)', (t) => {
	const root = project(t, {
		'tsconfig.json': '{ "compilerOptions": { "jsx": "preserve" } }',
		'src/deep.tsx': `export const v = ${'<b>'.repeat(5000)}${'</b>'.repeat(5000)};`
	});
	const fileName = join(root, 'src/chart.ts');
	const source = 'import { v } from "./deep";\nexport const config = { type: "bar", v };';
	const read = openSession(fileName).analyze(fileName, source);
	assert.deepEqual([read.readable, read.diagnostics.map(({ code }) => code)], [false, ['CFG_TOO_COMPLEX']]);
	assert.deepEqual(summary(read), summary(analyzeProject(source, fileName)));
});
