import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';

import { escapeData, escapeProperty, githubCommands } from '../dist/github.js';
import { example, run, sourceProject } from './helpers.mjs';

/**
 * `--format github` (CG-06-08): each finding a GitHub workflow command, which a workflow shows as an
 * annotation on the line of the value it is about. Every value is escaped as GitHub reads commands:
 * a config's key or a file name never starts a command of its own.
 */
const uriOf = (file) => relative(process.cwd(), file).split(sep).join('/');
/** A line of output is one of ChartGuard's annotations or its summary, nothing else. */
const ANNOTATION = /^::(?:error|warning|notice) file=[^:\r\n]*::[^\r\n]*$/u;
const SUMMARY = /^ChartGuard: \d+ error\(s\), \d+ warning\(s\), \d+ notice\(s\)\.$/u;

const finding = (diagnostic, extra = {}) => ({
	diagnostic: { confidence: 'certain', path: '$', message: 'm', severity: 'error', code: 'CFG_TYPE', ...diagnostic },
	file: join(process.cwd(), 'charts', 'a.json'),
	...extra
});

test('escaping follows GitHub: data escapes %, CR and LF; properties also : and ,', () => {
	assert.equal(escapeData('50% done\r\nnext::x'), '50%25 done%0D%0Anext::x');
	assert.equal(escapeProperty('a,b:c%\n'), 'a%2Cb%3Ac%25%0A');
});

test('a finding is a command of its severity at its file and region; info is a notice', () => {
	const region = { startLine: 3, startColumn: 5, endLine: 3, endColumn: 9 };
	assert.deepEqual(
		githubCommands([
			finding({ code: 'CFG_TYPE', path: '$.a', message: 'Expected number, got string.' }, { region }),
			finding({
				severity: 'warning',
				code: 'CFG_UNKNOWN_KEY',
				path: '$.b',
				message: 'Unknown.',
				suggestion: 'Did you mean "c"?'
			}),
			finding(
				{ severity: 'info', code: 'CFG_DYNAMIC', path: '$.c', message: 'Dynamic.' },
				{ region: { ...region, endLine: 4 } }
			)
		]),
		[
			'::error file=charts/a.json,line=3,col=5,endLine=3,endColumn=8,title=ChartGuard CFG_TYPE::$.a: Expected number, got string.',
			'::warning file=charts/a.json,title=ChartGuard CFG_UNKNOWN_KEY::$.b: Unknown. Did you mean "c"?',
			'::notice file=charts/a.json,line=3,col=5,endLine=4,endColumn=9,title=ChartGuard CFG_DYNAMIC::$.c: Dynamic.',
			'ChartGuard: 1 error(s), 1 warning(s), 1 notice(s).'
		]
	);
});

test('a suppressed quality finding is no annotation: it was suppressed with a reason', () => {
	assert.deepEqual(githubCommands([finding({}, { suppressed: 'context.background: the page is white' })]), [
		'ChartGuard: 0 error(s), 0 warning(s), 0 notice(s).'
	]);
});

test('text from a config never starts a workflow command of its own', () => {
	const hostile = finding(
		{ path: '$["a\\n::set-env name=X::y"]', message: 'Unknown property "a\n::add-mask::secret" for this schema.' },
		{ file: join(process.cwd(), 'x,y:z\n::stop-commands::t.json') }
	);
	const lines = githubCommands([hostile]).flatMap((command) => command.split(/\r|\n/u));
	assert.equal(lines.length, 2);
	assert.match(lines[0], ANNOTATION);
	assert.ok(lines[0].includes('file=x%2Cy%3Az%0A%3A%3Astop-commands%3A%3At.json,'), lines[0]);
	assert.match(lines[0], /%0A::add-mask::secret/u);
	assert.match(lines[1], SUMMARY);
});

test('validate --format github: the annotations at the lines of the values, the exit status unchanged', async () => {
	const file = example('chartjs-invalid.json');
	const { code, out } = await run(['validate', '--library', 'chartjs', '--file', file, '--format', 'github']);
	assert.equal(code, 1);
	const lines = out.split('\n');
	for (const line of lines.slice(0, -1)) assert.match(line, ANNOTATION);
	assert.match(lines.at(-1), SUMMARY);
	const min = lines.find((line) => line.includes('$.options.scales.y.min'));
	const text = readFileSync(file, 'utf8').split('\n');
	const at = Number(/line=(\d+)/u.exec(min)[1]);
	assert.match(text[at - 1], /"min"/u);
	assert.ok(min.startsWith(`::error file=${uriOf(file)},line=`));
});

test('analyze --format github: findings at the source range that wrote them; quality fails only on request', async (t) => {
	const root = sourceProject(t, {
		'chart.ts':
			"import { Chart } from 'chart.js';\nnew Chart(canvas, { type: 'bar', data: { datasets: [] }, options: { responsive: 'yes' } });\n"
	});
	const { code, out } = await run([
		'analyze',
		'--library',
		'chartjs',
		'--file',
		join(root, 'chart.ts'),
		'--format',
		'github'
	]);
	assert.equal(code, 1);
	assert.match(
		out,
		/^::error file=[^,]*chart\.ts,line=2,col=\d+,endLine=2,endColumn=\d+,title=ChartGuard CFG_TYPE::\$\.options\.responsive: /mu
	);
	const quality = await run([
		'quality',
		'--library',
		'chartjs',
		'--file',
		example('chartjs-valid-subset.json'),
		'--format',
		'github'
	]);
	assert.equal(quality.code, 0);
	assert.match(quality.out.split('\n').at(-1), SUMMARY);
});

test('github is a format of every config command, also from a config file', async () => {
	const { code, err } = await run([
		'validate',
		'--library',
		'chartjs',
		'--file',
		example('chartjs-valid-subset.json'),
		'--format',
		'gitlab'
	]);
	assert.equal(code, 2);
	assert.match(err, /unknown --format 'gitlab' \(text, json, sarif, github\)/u);
});
