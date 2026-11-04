import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';

import plugin from '../dist/index.js';

/**
 * Project mode (CG-06-03 part 3): with `settings.chartguard.project`, a file is read with its project's
 * tsconfig through its imports, in one session per project for the whole lint run.
 */
function project(t, files) {
	const root = mkdtempSync(join(tmpdir(), 'chartguard-eslint-project-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	for (const [name, text] of Object.entries({ 'tsconfig.json': '{}', ...files })) {
		mkdirSync(join(root, name, '..'), { recursive: true });
		writeFileSync(join(root, name), text);
	}
	return root;
}

/** ESLint's config findings (message, line, column, fix) for `code` as `root/file`, with `chartguard` settings. */
async function lint(root, file, code, chartguard) {
	const eslint = new ESLint({
		cwd: root,
		overrideConfigFile: true,
		overrideConfig: [
			{ files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
			{ ...plugin.configs.recommended, settings: { chartguard } }
		]
	});
	const [result] = await eslint.lintText(code, { filePath: join(root, file) });
	return result.messages
		.filter(({ ruleId }) => ruleId !== 'chartguard/chart-quality')
		.map(({ message, line, column, fix }) => ({ message, line, column, fixed: fix !== undefined }));
}

const CHART = "import { Chart } from 'chart.js';\nimport { options } from './options';\n";
const USE = `${CHART}new Chart(ctx, { type: 'bar', data: { datasets: [] }, options });`;

/** What Chart.js does with a responsive that is not a boolean, as the schema says (A73). */
const RESPONSIVE =
	'Chart.js compares responsive with !== to whether it listens for resizes (a boolean), so any other value makes every update unbind and bind all its event listeners again; a truthy one also runs its resize step each time, which can recurse when the container size follows the chart.';
test('project: a value written in an imported file is checked, reported at the use with where it was written', async (t) => {
	const root = project(t, { 'src/options.ts': "export const options = { responsive: 'yes' };" });
	assert.deepEqual(await lint(root, 'src/chart.ts', USE, {}), []);
	assert.deepEqual(await lint(root, 'src/chart.ts', USE, { project: true }), [
		{
			message: `CFG_TYPE $.options.responsive: Expected boolean | function, got string. ${RESPONSIVE} (written in src/options.ts:1:38)`,
			line: 3,
			column: 1,
			fixed: false
		}
	]);
});

test('project: a finding in the linted file stands at its value, as one file at a time does', async (t) => {
	const root = project(t, { 'src/options.ts': 'export const options = { responsive: true };' });
	const code = `${CHART}new Chart(ctx, { type: 'bar', data: { datasets: [] }, options: { ...options, scales: { y: { min: 'x' } } } });`;
	assert.deepEqual(await lint(root, 'src/chart.ts', code, { project: true }), [
		{
			message: 'CFG_TYPE $.options.scales.y.min: Expected number | function, got string.',
			line: 3,
			column: code.split('\n')[2].indexOf("'x'") + 1,
			fixed: false
		}
	]);
});

test('project: no fix for a key written in another file', async (t) => {
	const root = project(t, {
		'src/pie.ts': "export const pie = { type: 'pie', clockWise: false, data: [1] } as const;"
	});
	const code =
		"import * as echarts from 'echarts';\nimport { pie } from './pie';\necharts.init(el).setOption({ series: [pie] });";
	const found = await lint(root, 'src/chart.ts', code, { project: true });
	assert.deepEqual(
		found.map(({ message, fixed }) => [message.split(':')[0], fixed]),
		[['CFG_DEPRECATED $.series[0].clockWise', false]]
	);
	assert.match(found[0].message, /\(written in src\/pie\.ts:1:46\)$/u);
});

test("project: a named tsconfig, relative to ESLint's working directory; an unusable one stops the lint", async (t) => {
	const root = project(t, {
		'config/tsconfig.app.json': '{ "compilerOptions": { "baseUrl": ".." } }',
		'src/options.ts': "export const options = { responsive: 'yes' };"
	});
	const named = await lint(root, 'src/chart.ts', USE, { project: 'config/tsconfig.app.json' });
	assert.equal(named.length, 1);
	await assert.rejects(
		lint(root, 'src/chart.ts', USE, { project: 'config/missing.json' }),
		/settings\.chartguard\.project: /u
	);
	await assert.rejects(lint(root, 'src/chart.ts', USE, { project: '' }), /must be true, false or a tsconfig path/u);
	await assert.rejects(
		lint(root, 'src/chart.ts', USE, { project: 3 }),
		/settings\.chartguard\.project: must be true, false or a tsconfig path/u
	);
});

test('project: one session per project for a lint run, so the files after the first read only what changed', async (t) => {
	const root = project(t, { 'src/options.ts': 'export const options = { responsive: true };' });
	const eslint = new ESLint({
		cwd: root,
		overrideConfigFile: true,
		overrideConfig: [
			{ files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
			{ ...plugin.configs.recommended, settings: { chartguard: { project: true } } }
		]
	});
	const time = async (file) => {
		const start = performance.now();
		await eslint.lintText(USE, { filePath: join(root, file) });
		return performance.now() - start;
	};
	const first = await time('src/a.ts');
	const others = Math.min(await time('src/b.ts'), await time('src/c.ts'), await time('src/d.ts'));
	assert.ok(others * 3 < first, `first ${first.toFixed(0)} ms, others ${others.toFixed(0)} ms`);
});
