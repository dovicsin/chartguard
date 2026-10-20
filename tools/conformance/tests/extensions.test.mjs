import assert from 'node:assert/strict';
import test from 'node:test';

import { validate, withExtensions } from '@chartguard/config-chartjs';
import { s } from '@chartguard/config-core';
import { BarController, Chart } from 'chart.js';

import { verdictOf } from '../lib/capture.mjs';
import { runChartjs } from '../lib/chartjs.mjs';

/** A controller a plugin would ship: a funnel chart built on bar, recording which datasets it draws. */
class FunnelController extends BarController {
	static id = 'funnel';
	static defaults = { ...BarController.defaults };
	static overrides = BarController.overrides;
	static drawn = [];

	initialize() {
		super.initialize();
		FunnelController.drawn.push(this.getDataset().label);
	}
}

test('a controller extension matches the runtime: an untyped dataset of the new chart type uses the new controller (CG-02-05)', (t) => {
	Chart.register(FunnelController);
	t.after(() => Chart.unregister(FunnelController));
	const config = (dataset) => ({ type: 'funnel', data: { labels: ['a'], datasets: [{ label: 'untyped', data: [1], ...dataset }] } });
	FunnelController.drawn.length = 0;
	assert.equal(verdictOf(runChartjs(config({}))), 'accepted');
	assert.equal(verdictOf(runChartjs({ type: 'line', data: { labels: ['a'], datasets: [{ type: 'funnel', label: 'typed', data: [1] }] } })), 'accepted');
	assert.equal(verdictOf(runChartjs(config({ type: 'bar', label: 'bar in funnel' }))), 'accepted');
	assert.deepEqual(FunnelController.drawn, ['untyped', 'typed']);
	// The validator models the same: the untyped dataset is a funnel dataset, checked with the controller's options.
	const validator = withExtensions([{ id: 'funnel', controllers: { funnel: { extends: 'bar', dataset: s.object({ shrinkFraction: s.number() }) } } }]);
	const errors = validator(config({ shrinkFraction: 'x' })).diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.path}`);
	assert.deepEqual(errors, ['CFG_TYPE $.data.datasets[0].shrinkFraction']);
	assert.equal(validator(config({ shrinkFraction: 0.5 })).valid, true);
	assert.deepEqual(validate(config({})).diagnostics.map((d) => d.code), ['CFG_UNKNOWN_VARIANT']);
});
