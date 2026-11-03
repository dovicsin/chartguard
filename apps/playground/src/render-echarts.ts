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
	},
	// `init` returns the instance before `setOption` can throw, so `dispose` always reaches it.
	stray: () => 0,
	held: () => (chart === undefined || chart.isDisposed() ? 0 : 1),
	// echarts/lib/util/log.js: `outputLog` keeps every message printed with `onlyOnce` in `storedLogs`.
	logsOnce: true
};
