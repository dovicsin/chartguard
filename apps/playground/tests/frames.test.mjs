import assert from 'node:assert/strict';
import test from 'node:test';

import { isDrawn, isReply, isRequest } from '../dist/frame-protocol.js';
import { Capture } from '../dist/runtime.js';
import { transpile } from '../dist/transpile.js';

/** The drawing frames (CG-06-06 part 4): the messages both sides accept, the code a frame runs, what it captures. */
test('a frame accepts a request only in the shapes of the protocol, for a library it draws', () => {
	for (const request of [
		{ kind: 'config', library: 'chartjs', config: {} },
		{ kind: 'config', library: 'echarts', config: null },
		{ kind: 'code', code: '' }
	])
		assert.equal(isRequest(request), true, JSON.stringify(request));
	for (const request of [
		null,
		'code',
		[],
		{ kind: 'config', library: 'highcharts', config: {} },
		{ kind: 'config', library: 'chartjs' },
		{ kind: 'code', code: 1 },
		{ kind: 'eval', code: '' }
	])
		assert.equal(isRequest(request), false, JSON.stringify(request));
	assert.equal(isDrawn('echarts'), true);
	assert.equal(isDrawn('highcharts'), false);
});

test('the page accepts a reply only in the shapes of the protocol', () => {
	const outcome = { kind: 'outcome', verdict: 'complained', messages: ['a'], uncaught: [] };
	assert.equal(isReply({ kind: 'ready' }), true);
	assert.equal(isReply(outcome), true);
	for (const reply of [
		undefined,
		{ kind: 'outcome' },
		{ ...outcome, verdict: 'fine' },
		{ ...outcome, messages: [1] },
		{ ...outcome, uncaught: 'x' },
		{ ...outcome, messages: 'a' },
		[outcome]
	])
		assert.equal(isReply(reply), false, JSON.stringify(reply));
});

test('the source is run as CommonJS: its imports become require calls of the bundled runtimes', () => {
	const code = transpile(
		"import { Chart } from 'chart.js';\nimport * as echarts from 'echarts';\nconst size: number = 2;\nnew Chart(c, { type: 'bar', data: { datasets: [] } });\necharts.init(el);",
		'chart.ts'
	);
	assert.match(code, /require\("chart\.js"\)/u);
	assert.match(code, /require\("echarts"\)/u);
	assert.doesNotMatch(code, /: number|^import /mu);
	assert.match(
		transpile("import Chart from 'chart.js/auto';\nnew Chart(c, {});", 'chart.js'),
		/__importDefault\(require\("chart\.js\/auto"\)\)/u
	);
});

test('a capture records warnings, errors and throws in order, and gives the verdict', () => {
	const target = { warn: () => {}, error: () => {} };
	const capture = new Capture(target);
	assert.equal(capture.verdict(), 'accepted');
	target.warn('[ECharts]', 'deprecated');
	assert.equal(capture.verdict(), 'complained');
	capture.run(() => {
		throw new Error('boom');
	});
	capture.run(() => {
		throw 'text';
	});
	assert.equal(capture.verdict(), 'rejected');
	assert.deepEqual(capture.messages(), ['[ECharts] deprecated', 'boom', 'text']);
	const errors = new Capture(target);
	target.error('bad');
	assert.equal(errors.verdict(), 'rejected');
});
