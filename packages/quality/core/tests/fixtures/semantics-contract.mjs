/**
 * One chart, written for each library (CG-05-03): every extractor must give it the same semantics,
 * and tools/conformance checks each config against what its runtime builds. A series is summarized as
 * `[kind, coordinateSystem, orientation, stacking, valueAxisSlot]`: the slot is the order in which its
 * value axis first appears among the chart's series, `-` where the fact is inapplicable.
 */
const LABELS = ['Q1', 'Q2'];

export const SEMANTICS_CONTRACT = [
	{
		name: 'bars with a line on a second value axis',
		semantics: [
			['bar', 'cartesian', 'vertical', 'none', 0],
			['line', 'cartesian', 'vertical', 'none', 1]
		],
		chartjs: {
			type: 'bar',
			data: {
				labels: LABELS,
				datasets: [
					{ label: 'Revenue', data: [5, 7] },
					{ type: 'line', label: 'Margin', data: [20, 25], yAxisID: 'y1' }
				]
			},
			// Without `y` here, the bars would be on y1 too: a dataset with no yAxisID is on the first y scale.
			options: { scales: { y: {}, y1: { position: 'right' } } }
		},
		echarts: {
			xAxis: { type: 'category', data: LABELS },
			yAxis: [{ type: 'value' }, { type: 'value' }],
			series: [
				{ type: 'bar', name: 'Revenue', data: [5, 7] },
				{ type: 'line', name: 'Margin', data: [20, 25], yAxisIndex: 1 }
			]
		},
		highcharts: {
			xAxis: { categories: LABELS },
			yAxis: [{}, { opposite: true }],
			series: [
				{ type: 'column', name: 'Revenue', data: [5, 7] },
				{ type: 'line', name: 'Margin', data: [20, 25], yAxis: 1 }
			]
		}
	},
	{
		name: 'horizontal stacked bars',
		semantics: [
			['bar', 'cartesian', 'horizontal', 'stacked', 0],
			['bar', 'cartesian', 'horizontal', 'stacked', 0]
		],
		chartjs: {
			type: 'bar',
			data: {
				labels: LABELS,
				datasets: [
					{ label: 'a', data: [1, 2] },
					{ label: 'b', data: [3, 4] }
				]
			},
			options: { indexAxis: 'y', scales: { x: { stacked: true }, y: { stacked: true } } }
		},
		echarts: {
			xAxis: { type: 'value' },
			yAxis: { type: 'category', data: LABELS },
			series: [
				{ type: 'bar', stack: 'total', data: [1, 2] },
				{ type: 'bar', stack: 'total', data: [3, 4] }
			]
		},
		highcharts: {
			chart: { type: 'bar' },
			xAxis: { categories: LABELS },
			plotOptions: { series: { stacking: 'normal' } },
			series: [{ data: [1, 2] }, { data: [3, 4] }]
		}
	},
	{
		name: 'stacked areas',
		semantics: [
			['area', 'cartesian', 'vertical', 'stacked', 0],
			['area', 'cartesian', 'vertical', 'stacked', 0]
		],
		chartjs: {
			type: 'line',
			data: {
				labels: LABELS,
				datasets: [
					{ label: 'a', data: [1, 2], fill: true },
					{ label: 'b', data: [3, 4], fill: '-1' }
				]
			},
			options: { scales: { y: { stacked: true } } }
		},
		echarts: {
			xAxis: { type: 'category', data: LABELS },
			yAxis: { type: 'value' },
			series: [
				{ type: 'line', stack: 'total', areaStyle: {}, data: [1, 2] },
				{ type: 'line', stack: 'total', areaStyle: {}, data: [3, 4] }
			]
		},
		highcharts: {
			chart: { type: 'area' },
			xAxis: { categories: LABELS },
			plotOptions: { area: { stacking: 'normal' } },
			series: [{ data: [1, 2] }, { data: [3, 4] }]
		}
	},
	{
		name: 'a pie',
		semantics: [['pie', '-', '-', '-', '-']],
		chartjs: { type: 'pie', data: { labels: LABELS, datasets: [{ data: [1, 2] }] } },
		echarts: {
			series: [
				{
					type: 'pie',
					data: [
						{ name: 'Q1', value: 1 },
						{ name: 'Q2', value: 2 }
					]
				}
			]
		},
		highcharts: {
			series: [
				{
					type: 'pie',
					data: [
						['Q1', 1],
						['Q2', 2]
					]
				}
			]
		}
	}
];

/** The summary of normalized semantics, in the contract's form. */
export function summarize(chart) {
	const slots = [];
	const value = (fact) => (fact.known ? fact.value : `? ${fact.reason}`);
	const orInapplicable = (fact) => (!fact.known && fact.reason === 'inapplicable' ? '-' : value(fact));
	return chart.series.items.map(({ kind, coordinateSystem, orientation, stacking, valueAxis }) => {
		if (valueAxis.known && !slots.includes(valueAxis.value)) slots.push(valueAxis.value);
		const slot = valueAxis.known ? slots.indexOf(valueAxis.value) : orInapplicable(valueAxis);
		return [value(kind), orInapplicable(coordinateSystem), orInapplicable(orientation), orInapplicable(stacking), slot];
	});
}
