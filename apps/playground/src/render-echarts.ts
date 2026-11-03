import { type EChartsOption, init } from 'echarts';

import type { Renderer } from './runtime.js';

/** The full ECharts bundle, matching the generated schema; the option is copied for the same reason as Chart.js. */
export const echartsRenderer: Renderer = {
	render(container, config) {
		const host = document.createElement('div');
		host.className = 'echarts-host';
		container.replaceChildren(host);
		init(host).setOption(structuredClone(config) as EChartsOption);
	}
};
