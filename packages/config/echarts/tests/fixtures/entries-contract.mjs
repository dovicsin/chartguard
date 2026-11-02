/**
 * Like RUNTIME_CONTRACT, for root options of components given values that are not objects
 * (CG-02-10): echarts reads a component option as a list and skips an entry that is not an object,
 * unless a preprocessor reads that entry first and throws.
 */
const axes = { xAxis: { type: 'category', data: ['a'] }, yAxis: { type: 'value' } };

export const ENTRIES_CONTRACT = [
	{
		name: 'a series list with entries that are not objects',
		config: { ...axes, series: [null, 5, { type: 'line', data: [1] }] },
		findings: ['warning CFG_INEFFECTIVE $.series[0]', 'warning CFG_INEFFECTIVE $.series[1]'],
		runtime: 'accepted',
		why: 'No effect: `mappingToExists` skips an entry that is not an object; the chart renders without it.'
	},
	{
		name: 'a component given as a falsy value, and an axis list starting with null',
		config: {
			title: 0,
			xAxis: [null, { type: 'category', data: ['a'] }],
			yAxis: { type: 'value' },
			series: [{ type: 'line', data: [1], xAxisIndex: 1 }]
		},
		findings: ['warning CFG_INEFFECTIVE $.title', 'warning CFG_INEFFECTIVE $.xAxis[0]'],
		runtime: 'accepted',
		why: 'No effect: one value is a list of one (`normalizeToArray`), and an entry that is not an object is skipped.'
	},
	{
		name: 'a title given as a number: the layout compatibility reads it before it could be skipped',
		config: { title: 5 },
		findings: ['error CFG_TYPE $.title'],
		runtime: 'rejected'
	},
	{
		name: 'a listed null radar: its preprocessor reads every listed entry',
		config: { radar: [null] },
		findings: ['error CFG_TYPE $.radar[0]'],
		runtime: 'rejected'
	},
	{
		name: 'a root option set to null is absent',
		config: { ...axes, title: null, legend: null, series: [{ type: 'line', data: [1] }] },
		findings: [],
		runtime: 'accepted'
	}
];
