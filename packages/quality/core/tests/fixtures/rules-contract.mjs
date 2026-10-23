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
import { MOTION_CASES } from './motion-cases.mjs';
import { PIE_CASES } from './pie-cases.mjs';
import { RANGE_CASES } from './ranges-cases.mjs';
import { SCALE_CASES } from './scales-cases.mjs';
import { UNKNOWN_CASES } from './unknown-cases.mjs';
import { MORE_COUNTEREXAMPLES, UNKNOWN_LABEL_CASES } from './unknown-label-cases.mjs';

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

/**
 * A case as a real chart would be written: titled unless it is about labels, described to assistive
 * technology unless it is about access, in colours with contrast unless it is about contrast.
 */
function realistic(entry) {
	const config = (key, value) => {
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
	...ACCESS_CASES,
	...MOTION_CASES,
	...RANGE_CASES,
	...MORE_COUNTEREXAMPLES,
	...UNKNOWN_CASES,
	...UNKNOWN_LABEL_CASES,
	...CONTEXT_CASES,
	...SETTING_CASES
].map(realistic);
