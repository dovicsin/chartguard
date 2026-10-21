import assert from 'node:assert/strict';
import test from 'node:test';

import { Chart, Legend } from 'chart.js';

import { createChartjs, withChartjsModules } from '../../../../tools/conformance/lib/chartjs.mjs';
import { guard, registriesOf } from '../dist/index.js';

const LINE_ONLY = ['LineController', 'LineElement', 'PointElement', 'CategoryScale', 'LinearScale'];
const line = (extra = {}, options = {}) => ({
	type: 'line',
	data: { labels: ['a'], datasets: [{ label: 'a', data: [1], ...extra }] },
	options
});
const findings = (result) =>
	result.diagnostics.filter((d) => d.severity !== 'info').map((d) => `${d.severity} ${d.code} ${d.path}`);

test('registriesOf reads what Chart.registry holds now', () =>
	withChartjsModules(LINE_ONLY, () => {
		assert.deepEqual(registriesOf(Chart), {
			'chartjs.controllers': { names: ['line'], complete: true },
			'chartjs.scales': { names: ['category', 'linear'], complete: true },
			'chartjs.plugins': { names: [], complete: true }
		});
	}));

test("a config's inline plugins count as plugins; one that cannot be read makes the plugins incomplete", () =>
	withChartjsModules(LINE_ONLY, () => {
		assert.deepEqual(registriesOf(Chart, [Legend])['chartjs.plugins'], { names: ['legend'], complete: true });
		let reads = 0;
		const hidden = Object.defineProperty({}, 'id', { get: () => ((reads += 1), 'legend') });
		assert.deepEqual(registriesOf(Chart, [Legend, hidden])['chartjs.plugins'], { names: ['legend'], complete: false });
		assert.equal(reads, 0);
		assert.equal(registriesOf(Chart, 'legend')['chartjs.plugins'].complete, false);
		// A bundler may expose the runtime through getters: it is the library, read as it is exposed.
		const bundled = Object.defineProperty({}, 'registry', { get: () => Chart.registry });
		assert.deepEqual(registriesOf(bundled), registriesOf(Chart));
		assert.deepEqual(registriesOf({}), {});
		assert.deepEqual(registriesOf({ registry: { controllers: { items: {} } } }), {});
	}));

test('the guard checks a tree-shaken chart against its registry: block keeps Chart.js from throwing', () =>
	withChartjsModules(LINE_ONLY, () => {
		const config = line({ type: 'bar' });
		assert.throws(() => createChartjs(structuredClone(config)), /"bar" is not a registered controller/);
		const results = [];
		const chart = createChartjs(
			guard(structuredClone(config), { block: true, onResult: (result) => results.push(result) })
		);
		chart.destroy();
		assert.deepEqual(findings(results[0]), ['error CFG_UNREGISTERED $.data.datasets[0].type']);
	}));

test('an option of a plugin that is neither registered nor inline has no effect; an inline one does', () =>
	withChartjsModules(LINE_ONLY, () => {
		// Chart.js writes its defaults into the options it gets: each chart has its own.
		const options = () => ({ plugins: { legend: { position: 'left' } } });
		const results = [];
		const onResult = (result) => results.push(result);
		const plain = createChartjs(guard(line({}, options()), { onResult }));
		assert.equal(plain.legend, undefined);
		plain.destroy();
		const inline = createChartjs(guard({ ...line({}, options()), plugins: [Legend] }, { onResult }));
		assert.equal(inline.legend.position, 'left');
		inline.destroy();
		assert.deepEqual(findings(results[0]), ['warning CFG_INEFFECTIVE $.options.plugins.legend']);
		assert.deepEqual(findings(results[1]), []);
	}));

test('a registry the caller names replaces the one read from the runtime', () =>
	withChartjsModules(LINE_ONLY, () => {
		const results = [];
		const registries = { 'chartjs.controllers': { names: [], complete: false } };
		const config = guard(line({ type: 'bar' }), {
			block: true,
			options: { registries },
			onResult: (result) => results.push(result)
		});
		// An incomplete registry claims nothing, so nothing is blocked and Chart.js throws as it would.
		assert.throws(() => createChartjs(config), /"bar" is not a registered controller/);
		assert.deepEqual(findings(results[0]), []);
	}));
