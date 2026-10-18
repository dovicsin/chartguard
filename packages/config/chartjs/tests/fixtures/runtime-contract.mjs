/**
 * Configurations whose validator findings and runtime behaviour are both pinned. `findings` is
 * every diagnostic as `severity code path`; `runtime` is how chart.js@4.5.1 reacts
 * (tools/conformance): `accepted`, `complained` or `rejected`. Wherever the two disagree, `why`
 * says which kind of disagreement it is (`Type contract:`, `Unresolved:`,
 * `False negative (CG-XX-YY):`); see the ECharts table for the definitions.
 */
const bar = (extra = {}) => ({ type: 'bar', data: { labels: ['a'], datasets: [{ data: [1], ...extra }] } });

export const RUNTIME_CONTRACT = [
	{
		name: 'data is not an object',
		config: { type: 'bar', data: 'x' },
		findings: ['error CFG_TYPE $.data'],
		runtime: 'rejected'
	},
	{
		name: 'responsive string',
		config: { type: 'bar', data: { datasets: [] }, options: { responsive: 'yes' } },
		findings: ['error CFG_TYPE $.options.responsive'],
		runtime: 'accepted',
		why: 'Type contract: declared `boolean`; the runtime renders it without an error or warning.'
	},
	{
		name: 'background color boolean',
		config: bar({ backgroundColor: true }),
		findings: ['error CFG_TYPE $.data.datasets[0].backgroundColor'],
		runtime: 'accepted',
		why: 'Type contract: declared `Color | Color[] | callback`; the runtime renders it without an error or warning.'
	},
	{
		name: 'linear scale min string',
		config: { ...bar(), options: { scales: { y: { type: 'linear', min: '50' } } } },
		findings: ['error CFG_TYPE $.options.scales.y.min'],
		runtime: 'accepted',
		why: 'Type contract: declared `number`; LinearScaleBase.parse coerces it with `+raw`.'
	},
	{
		name: 'dataset label null',
		config: bar({ label: null }),
		findings: ['error CFG_TYPE $.data.datasets[0].label'],
		runtime: 'accepted',
		why: 'Type contract: declared `string`; the runtime renders it without an error or warning.'
	},
	{
		name: 'animation true',
		config: { ...bar(), options: { animation: true } },
		findings: ['error CFG_ENUM $.options.animation'],
		runtime: 'accepted',
		why: 'Type contract: declared `false | AnimationSpec`; Animations.configure returns early for a non-object and keeps the defaults.'
	},
	{
		name: 'missing data',
		config: { type: 'bar' },
		findings: [],
		runtime: 'accepted'
	},
	{
		name: 'dataset without data',
		config: { type: 'bar', data: { datasets: [{ label: 'a' }] } },
		findings: [],
		runtime: 'accepted'
	},
	{
		name: 'plugin scale type',
		config: { type: 'line', data: { datasets: [] }, options: { scales: { x: { type: 'realtime' } } } },
		findings: ['warning CFG_UNKNOWN_VARIANT $.options.scales.x.type'],
		runtime: 'rejected',
		why: 'Unresolved: chartjs-plugin-streaming registers this scale; the harness does not install it.'
	},
	{
		name: 'unregistered chart type',
		config: { ...bar(), type: 'barr' },
		findings: ['warning CFG_UNKNOWN_VARIANT $.type'],
		runtime: 'rejected',
		why: 'Unresolved: a plugin may register this controller; here it is a typo the warning suggests a fix for.'
	},
	{
		name: 'radial scale type typo',
		config: { type: 'pie', data: { datasets: [{ data: [1] }] }, options: { scales: { r: { type: 'radialLiner' } } } },
		findings: ['warning CFG_UNKNOWN_VARIANT $.options.scales.r.type'],
		runtime: 'rejected',
		why: 'Unresolved: scale types are a plugin registry; here it is a typo the warning suggests a fix for.'
	},
	{
		name: 'misspelt option key',
		config: { type: 'bar', data: { datasets: [] }, options: { responsiv: true } },
		findings: ['warning CFG_UNKNOWN_KEY $.options.responsiv'],
		runtime: 'accepted',
		why: 'Unresolved: the runtime ignores unknown keys; the warning carries a suggestion.'
	},
	{
		name: 'scale without type',
		config: { ...bar(), options: { scales: { y: { min: '50' } } } },
		findings: ['info CFG_AMBIGUOUS $.options.scales.y'],
		runtime: 'accepted'
	},
	{
		name: 'third-party plugin options',
		config: { type: 'bar', data: { datasets: [] }, options: { plugins: { datalabels: { color: '#fff' } } } },
		findings: [],
		runtime: 'accepted'
	}
];
