import * as chartjs from 'chart.js';
import { _adapters, Chart, registerables, registry } from 'chart.js';

import { observe } from './capture.mjs';
import { copyPlain } from './copy.mjs';

Chart.register(...registerables);

const DAY = 86_400_000;
const UNIT_MS = { millisecond: 1, second: 1000, minute: 60_000, hour: 3_600_000, day: DAY, week: 7 * DAY, month: 30 * DAY, quarter: 91 * DAY, year: 365 * DAY };

/**
 * Time scales need a date adapter, which applications install (chartjs-adapter-date-fns, …).
 * This minimal UTC adapter stands in for one so time-scale configs can be rendered; it is
 * coarse (fixed-length months) because conformance needs acceptance, not exact ticks.
 */
_adapters._date.override({
	formats: () => Object.fromEntries(Object.keys(UNIT_MS).map((unit) => [unit, unit])),
	parse: (value) => (value === null || value === undefined ? null : new Date(value).getTime()),
	format: (time) => new Date(time).toISOString(),
	add: (time, amount, unit) => time + amount * UNIT_MS[unit],
	diff: (max, min, unit) => (max - min) / UNIT_MS[unit],
	startOf: (time, unit) => time - (time % (UNIT_MS[unit] ?? 1)),
	endOf: (time, unit) => time - (time % (UNIT_MS[unit] ?? 1)) + (UNIT_MS[unit] ?? 1) - 1
});

/** A 2D context whose drawing calls do nothing; text measures as 10px wide. */
function fakeContext(canvas) {
	const state = new Map();
	const methods = {
		measureText: () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
		createLinearGradient: () => ({ addColorStop() {} }),
		createRadialGradient: () => ({ addColorStop() {} }),
		createPattern: () => ({}),
		getImageData: () => ({ data: new Uint8ClampedArray(4) })
	};
	return new Proxy(
		{},
		{
			get: (_, key) => (key === 'canvas' ? canvas : (methods[key] ?? (state.has(key) ? state.get(key) : () => undefined))),
			set: (_, key, value) => {
				state.set(key, value);
				return true;
			}
		}
	);
}

/**
 * Builds a chart with the pinned chart.js runtime on a fake canvas (Chart.js picks its
 * DOM-free BasicPlatform when there is no `window`). The config is passed unchanged.
 */
export function runChartjs(config) {
	return observe(() => {
		const canvas = { width: 400, height: 300, style: {}, addEventListener() {}, removeEventListener() {} };
		const context = fakeContext(canvas);
		canvas.getContext = () => context;
		// Chart.js writes its default scales into the config it receives; the caller's stays untouched.
		new Chart(canvas, copyPlain(config)).destroy();
	});
}

const EVERY_REGISTERABLE = registerables.flatMap((group) => (Array.isArray(group) ? group : Object.values(group)));

/** What the runtime has registered, as the validator's registry context (`chartjs.controllers`, `chartjs.scales`). */
function registeredNow() {
	const names = (typed) => Object.keys(typed.items).sort();
	return {
		'chartjs.controllers': { names: names(registry.controllers), complete: true },
		'chartjs.scales': { names: names(registry.scales), complete: true }
	};
}

/**
 * Runs `body` against a tree-shaken Chart.js: only `modules` (export names such as `LineController`,
 * `CategoryScale`) are registered, as `Chart.register(...)` in an application that imports from
 * `chart.js` rather than `chart.js/auto`. `body` receives the registry context read back from the
 * runtime. Every built-in is registered again afterwards, even when `body` throws.
 */
export function withChartjsModules(modules, body) {
	const items = modules.map((name) => {
		if (!EVERY_REGISTERABLE.includes(chartjs[name])) throw new Error(`not a chart.js registerable: ${name}`);
		return chartjs[name];
	});
	Chart.unregister(...EVERY_REGISTERABLE);
	try {
		Chart.register(...items);
		return body(registeredNow());
	} finally {
		Chart.unregister(...items);
		Chart.register(...EVERY_REGISTERABLE);
	}
}
