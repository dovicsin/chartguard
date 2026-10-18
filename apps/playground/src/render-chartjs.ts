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
		chart = new Chart(canvas, structuredClone(config) as ChartConfiguration);
	},
	dispose() {
		chart?.destroy();
		chart = undefined;
	}
};
