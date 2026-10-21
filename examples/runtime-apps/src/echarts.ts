import { setOption } from '@chartguard/runtime-echarts';
import { LineChart } from 'echarts/charts';
import { GridComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';

import { box, runApp, type Seen, seen } from './report.js';

// A tree-shaken ECharts: line series on a grid only.
echarts.use([SVGRenderer, LineChart, GridComponent]);

runApp(() => {
	const results: Seen[] = [];
	const guard = {
		echarts,
		block: true,
		onResult: (result: Parameters<typeof seen>[1], { fresh }: { fresh: boolean }) =>
			results.push(seen(fresh ? 'fresh' : 'merge', result))
	};
	const chart = echarts.init(box('div') as HTMLDivElement, null, { renderer: 'svg' });
	setOption(
		chart,
		{ xAxis: { type: 'category', data: ['Mon', 'Tue'] }, yAxis: {}, series: [{ type: 'line', data: [1, 2] }] },
		undefined,
		guard
	);
	// A merge update needs no type: it is checked as the line series it merges into.
	setOption(chart, { series: [{ data: [4, 5], smooth: true }] }, undefined, guard);
	// Switched to bars, but BarChart is not registered: echarts would drop the series; it is blocked.
	setOption(
		chart,
		{ xAxis: { type: 'category', data: ['Mon'] }, yAxis: {}, series: [{ type: 'bar', data: [1] }] },
		{ notMerge: true },
		guard
	);
	const series = (chart.getOption() as { series: { type: string; data: number[] }[] }).series;
	chart.dispose();
	return { library: 'echarts', results, series: series.map(({ type, data }) => `${type} ${data.join(',')}`) };
});
