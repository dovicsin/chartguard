import { type ECharts, type EChartsOption, init } from 'echarts';

import type { Renderer } from './runtime.js';

let chart: ECharts | undefined;

/** The full ECharts bundle, matching the generated schema; the option is copied for the same reason as Chart.js. */
export const echartsRenderer: Renderer = {
	render(container, config) {
		this.dispose();
		const host = document.createElement('div');
		host.className = 'echarts-host';
		container.replaceChildren(host);
		chart = init(host);
		chart.setOption(structuredClone(config) as EChartsOption);
	},
	dispose() {
		chart?.dispose();
		chart = undefined;
	}
};
