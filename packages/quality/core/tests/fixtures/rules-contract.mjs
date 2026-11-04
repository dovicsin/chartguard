/**
 * The rule catalog's cross-library fixtures (CG-05-04), the per-rule corpus (CG-05-05): every case
 * names its rule and its kind (a chart that triggers it, a counterexample, one whose deciding fact is
 * unknown, one with the page context or rule settings declared), written for each library that can
 * express it, with the findings each adapter must report (and those it must suppress). tools/conformance renders every config on its pinned
 * runtime and checks the premise of each finding on what the runtime built (the bars' axis range
 * excludes zero, the axis is logarithmic or reversed, two value axes are in use).
 */
import { ACCESS_CASES } from './access-cases.mjs';
import { COLOR_CASES } from './colors-cases.mjs';
import { CONTEXT_CASES, SETTING_CASES } from './context-cases.mjs';
import { CONTRAST_CASES } from './contrast-cases.mjs';
import { LABEL_CASES } from './labels-cases.mjs';
import { LEGEND_CASES } from './legend-cases.mjs';
import { MOTION_CASES } from './motion-cases.mjs';
import { PIE_CASES } from './pie-cases.mjs';
import { RANGE_CASES } from './ranges-cases.mjs';
import { SCALE_CASES } from './scales-cases.mjs';
import { UNKNOWN_CASES } from './unknown-cases.mjs';
import { MORE_COUNTEREXAMPLES, UNKNOWN_LABEL_CASES } from './unknown-label-cases.mjs';
import { UNKNOWN_LIBRARY_CASES } from './unknown-library-cases.mjs';

/**
 * Every case that is not about labels gets the titles a real chart has (a chart title, and a title on
 * each y axis): without them, the label rules would add their findings to every case.
 */
const TITLE = 'Quarterly sales';
const yTitled = (yAxis) =>
	Array.isArray(yAxis) ? yAxis.map(yTitled) : { ...yAxis, title: { text: 'Units', ...yAxis?.title } };
const TITLED = {
	chartjs: (config) => ({
		...config,
		options: { ...config.options, plugins: { title: { display: true, text: TITLE }, ...config.options?.plugins } }
	}),
	echarts: (option) => ({ title: { text: TITLE }, ...option }),
	highcharts: (config) => ({ title: { text: TITLE }, ...config, yAxis: yTitled(config.yAxis ?? {}) })
};

/**
 * Every case that is not about accessibility is an accessible chart: ECharts describes its data only
 * with `aria`; Highcharts's default colours fall below 3:1 on white, so it gets colours with 3:1 on
 * both its light and dark backgrounds.
 */
const ACCESSIBLE_COLORS = [
	'#1f77b4',
	'#d62728',
	'#2ca02c',
	'#9467bd',
	'#8c564b',
	'#7f7f7f',
	'#3366cc',
	'#dc3912',
	'#109618',
	'#0099c6'
];
const DESCRIBED = (key, option) => (key === 'echarts' ? { aria: { enabled: true }, ...option } : option);
const CONTRASTED = (key, config) =>
	key === 'highcharts' ? { palette: { colors: ACCESSIBLE_COLORS }, ...config } : config;

/** A copy of `object` with `key` set, its other properties (getters too) as they are: a getter is never run. */
const withOwn = (object, key, value) =>
	Object.create(Object.getPrototypeOf(object), {
		...Object.getOwnPropertyDescriptors(object),
		[key]: { value, writable: true, enumerable: true, configurable: true }
	});
/** The value of the data property `key` of `holder` (never a getter), or undefined. */
const ownValue = (holder, key) =>
	holder !== null && typeof holder === 'object' ? Object.getOwnPropertyDescriptor(holder, key)?.value : undefined;
/** The list at `key` of `holder`, or undefined. */
function listAt(holder, key) {
	const value = ownValue(holder, key);
	return Array.isArray(value) ? value : undefined;
}
/** The list with every plain item that has no own `nameKey` named; elements behind getters and holes stay as they are. */
function namedItems(list, nameKey) {
	const descriptors = Object.getOwnPropertyDescriptors(list);
	for (const [index, descriptor] of Object.entries(descriptors)) {
		const item = descriptor.value;
		if (index !== 'length' && item !== null && typeof item === 'object' && !Object.hasOwn(item, nameKey))
			descriptor.value = withOwn(item, nameKey, `Sales ${index}`);
	}
	return Object.defineProperties([], descriptors);
}
/**
 * Every case that is not about legends names its series, as a real chart does (echarts lists no unnamed
 * series): without names, legend-placeholder would add its findings to most Chart.js and Highcharts cases.
 */
const NAMED = {
	chartjs: (config) => {
		const data = ownValue(config, 'data');
		const datasets = listAt(data, 'datasets');
		return datasets === undefined
			? config
			: withOwn(config, 'data', withOwn(data, 'datasets', namedItems(datasets, 'label')));
	},
	echarts: (option) => option,
	highcharts: (config) => {
		const series = listAt(config, 'series');
		return series === undefined ? config : withOwn(config, 'series', namedItems(series, 'name'));
	}
};

/**
 * A case as a real chart would be written: titled unless it is about labels, its series named unless it
 * is about legends, described to assistive technology unless it is about access, in colours with
 * contrast unless it is about contrast.
 */
function realistic(entry) {
	const config = (key, original) => {
		const value = entry.legend === true ? original : NAMED[key](original);
		const titled = entry.labels === true ? value : TITLED[key](value);
		const described = entry.access === true ? titled : DESCRIBED(key, titled);
		return entry.contrast === true ? described : CONTRASTED(key, described);
	};
	return Object.fromEntries(
		Object.entries(entry).map(([key, value]) =>
			key in TITLED ? [key, { ...value, config: config(key, value.config) }] : [key, value]
		)
	);
}

export const RULES_CONTRACT = [
	...SCALE_CASES,
	...PIE_CASES,
	...COLOR_CASES,
	...CONTRAST_CASES,
	...LABEL_CASES,
	...LEGEND_CASES,
	...ACCESS_CASES,
	...MOTION_CASES,
	...RANGE_CASES,
	...MORE_COUNTEREXAMPLES,
	...UNKNOWN_CASES,
	...UNKNOWN_LABEL_CASES,
	...UNKNOWN_LIBRARY_CASES,
	...CONTEXT_CASES,
	...SETTING_CASES
].map(realistic);
