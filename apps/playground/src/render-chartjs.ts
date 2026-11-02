import 'chartjs-adapter-date-fns';

import { Chart, type ChartConfiguration, registerables } from 'chart.js';

import type { Renderer } from './runtime.js';

Chart.register(...registerables);

let chart: Chart | undefined;

/**
 * The real Chart.js runtime with every built-in controller, scale and plugin registered, and the
 * date-fns adapter applications install for time scales. Chart.js writes into the config it is
 * given, so it receives a copy and the editor's value stays what the validator saw.
 */
export const chartjsRenderer: Renderer = {
	render(container, config) {
		this.dispose();
		const canvas = document.createElement('canvas');
		container.replaceChildren(canvas);
		try {
			chart = new Chart(canvas, structuredClone(config) as ChartConfiguration);
		} catch (error) {
			// The constructor registers the chart and its resize listeners before its first update
			// throws; left alive, that chart updates again on the next resize and throws uncaught.
			Chart.getChart(canvas)?.destroy();
			throw error;
		}
	},
	dispose() {
		chart?.destroy();
		chart = undefined;
	},
	stray: () => Object.values(Chart.instances).filter((instance) => instance !== chart).length
};
