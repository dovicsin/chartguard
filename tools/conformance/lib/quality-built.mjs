import * as echarts from 'echarts';

import { colorKey, contrastRatio } from '../../../packages/quality/core/dist/index.js';
import { createChartjs } from './chartjs.mjs';
import { copyPlain } from './copy.mjs';
import { chartjsMotion, echartsMotion } from './motion.mjs';

/**
 * What each runtime built for a chart, as the quality rules' premises read it (CG-05-04): the value
 * axes the series are measured on, their range, scale and direction, colours and contrast, titles,
 * motion; and per rule code, the premise that must hold exactly when the rule claims a finding.
 */
export const PREMISES = {
	// Bars cut short: drawn on a range without zero, or from a base other than zero.
	VIS_BAR_BASELINE: ({ bars }) => bars.some(({ min, max, log, fromZero }) => !log && (min > 0 || max < 0 || !fromZero)),
	VIS_BAR_LOG_SCALE: ({ bars }) => bars.some(({ log }) => log),
	VIS_REVERSED_VALUE_AXIS: ({ valueAxes }) => valueAxes.some(({ reversed }) => reversed),
	// Two different value axes of one direction drawn over the same band of the chart: one plot (H9).
	VIS_DUAL_AXIS: ({ valueAxes }) =>
		valueAxes.some((a) =>
			valueAxes.some(
				(b) => a.id !== b.id && a.dir === b.dir && Math.max(a.span[0], b.span[0]) < Math.min(a.span[1], b.span[1])
			)
		),
	// A pie that does not show its values as given: a slice drawn for a negative value, or one left out.
	VIS_PIE_NEGATIVE: ({ pieMisdrawn }) => pieMisdrawn,
	// A drawn title whose text appears nowhere in the config: the library supplied it.
	VIS_PLACEHOLDER_TEXT: ({ title, valueAxes, config }) =>
		[title, ...valueAxes.map((axis) => axis.title)].some(
			(text) => text !== '' && !JSON.stringify(config).includes(JSON.stringify(text))
		),
	VIS_VALUE_AXIS_UNTITLED: ({ title, valueAxes }) => title === '' && valueAxes.some((axis) => axis.title === ''),
	// Two cartesian series the runtime drew in one colour.
	VIS_SAME_COLOR_SERIES: ({ colors }) => new Set(colors.map(colorKey)).size < colors.length,
	// Nothing in the chart describes its data to assistive technology (undefined: not measured here).
	VIS_DATA_NOT_DESCRIBED: ({ described }) => (described === undefined ? undefined : !described),
	// Keyboard access the library gives, turned off: nothing takes focus.
	VIS_KEYBOARD_DISABLED: ({ keyboardOff }) => keyboardOff === true,
	// A cartesian series drawn below 3:1 against the background the browser computed (undefined: page shows through).
	// Motion that runs forever, or longer than five seconds, as the runtime resolves it.
	VIS_LONG_MOTION: ({ motion }) => (motion === undefined ? undefined : motion.endless || motion.longest > 5000),
	VIS_LOW_CONTRAST_SERIES: ({ contrasts }) =>
		contrasts === undefined ? undefined : contrasts.some((ratio) => ratio !== undefined && ratio < 3),
	// A percent-stacked axis whose drawn tick labels and title show no % (undefined: no percent stacking in the library).
	VIS_PERCENT_WITHOUT_UNIT: ({ valueAxes }) =>
		valueAxes.some(({ percent }) => percent === undefined)
			? undefined
			: valueAxes.some(
					({ percent, labels, title }) => percent && ![...labels, title].some((text) => text.includes('%'))
				)
};

/** The declared page background in each scheme (a single colour is both). */
function pageBackground(options) {
	const background = options?.context?.background;
	return typeof background === 'string' ? { light: background, dark: background } : background;
}

/** Contrast of drawn colours against the page the caller declares, in each scheme it names. */
const pageContrasts = (colors, page) =>
	['light', 'dark'].flatMap((scheme) =>
		page?.[scheme] === undefined ? [] : colors.map((color) => contrastRatio(color, page[scheme]))
	);

/** Chart.js paints no background (nothing fills the whole canvas): its series are on the page the caller declares. */
function chartjsContrasts({ canvas }, colors, options) {
	const painted = canvas.fills.some(
		([x, y, width, height]) => x <= 0 && y <= 0 && width >= canvas.width && height >= canvas.height
	);
	const page = pageBackground(options);
	return !painted && page !== undefined ? pageContrasts(colors, page) : undefined;
}

/**
 * The contrast of echarts series: against its opaque `backgroundColor`, or, when it draws its full-size
 * background rectangle with no fill, against the page the caller declares.
 */
function echartsContrasts(chart, colors, options) {
	const background = chart.getModel().get('backgroundColor');
	if (typeof background === 'string' && background !== 'transparent')
		return colors.map((color) => contrastRatio(color, background));
	const unfilled = chart.renderToSVGString().includes('<rect width="400" height="300" x="0" y="0" fill="none">');
	const page = pageBackground(options);
	return unfilled && page !== undefined ? pageContrasts(colors, page) : undefined;
}

/** A title as Chart.js draws it: its text when displayed. */
const drawnText = ({ display, text }) => (display ? [text].flat().join(' ') : '');

/** Chart.js draws a bar from the pixel of its base value (zero unless `base` is set), even off the chart area, aligned to half a pixel. */
const chartjsFromZero = (meta) =>
	meta.type !== 'bar' ||
	meta.data.every(({ base }) => !Number.isFinite(base) || Math.abs(base - meta.vScale.getPixelForValue(0)) <= 1);

/** The band of the chart a scale is drawn over, along its own direction. */
const chartjsSpan = ({ vScale }) => (vScale.isHorizontal() ? [vScale.left, vScale.right] : [vScale.top, vScale.bottom]);

/** A dataset's value scale as Chart.js built it. */
const chartjsAxis = (meta) => ({
	id: meta.vScale.id,
	dir: meta.vScale.isHorizontal() ? 'x' : 'y',
	span: chartjsSpan(meta),
	min: meta.vScale.min,
	max: meta.vScale.max,
	log: meta.vScale.type === 'logarithmic',
	reversed: meta.vScale.options.reverse === true,
	title: drawnText(meta.vScale.options.title),
	fromZero: chartjsFromZero(meta)
});

/** Whether Chart.js drew an arc for a negative pie value. */
const chartjsPieMisdrawn = (metas) =>
	metas
		.filter(({ type }) => type === 'pie' || type === 'doughnut')
		.some((meta) => meta._parsed.some((value, index) => value < 0 && meta.data[index].circumference > 0));

/** The value scales Chart.js built for the datasets, and whether an arc was drawn for a negative value. */
export function builtChartjs(config, options) {
	const chart = createChartjs(copyPlain(config));
	try {
		const metas = chart.data.datasets.map((_, index) => chart.getDatasetMeta(index));
		const cartesian = metas.filter(({ vScale }) => vScale !== undefined);
		const colors = cartesian.map((meta) =>
			meta.type === 'line' ? meta.dataset.options.borderColor : meta.data[0].options.backgroundColor
		);
		return {
			motion: chartjsMotion(chart, config),
			colors,
			contrasts: chartjsContrasts(chart, colors, options),
			bars: cartesian.filter(({ type }) => type === 'bar').map(chartjsAxis),
			valueAxes: cartesian.map(chartjsAxis),
			pieMisdrawn: chartjsPieMisdrawn(metas),
			title: drawnText(chart.options.plugins.title),
			config
		};
	} finally {
		chart.destroy();
	}
}

/** A grid series' value axis as echarts built it, with the series' colour and where its bars start. */
function echartsAxis(model) {
	const system = model.coordinateSystem;
	const axis = system.getOtherAxis(system.getBaseAxis());
	const [min, max] = axis.scale.getExtent();
	const data = model.getData();
	// A bar's layout starts at its base along the value axis (`y` for vertical bars, `x` for horizontal ones).
	const zero = axis.toGlobalCoord(axis.dataToCoord(0));
	const fromZero =
		model.subType !== 'bar' ||
		data
			.mapArray((index) => data.getItemLayout(index)?.[axis.dim])
			.every((base) => !Number.isFinite(base) || Math.abs(base - zero) < 0.5);
	// The grid's band along the axis direction: axes in separate grids are separate charts.
	const rect = axis.grid.getRect();
	return {
		type: model.subType,
		id: `${axis.dim}${String(axis.model.componentIndex)}`,
		dir: axis.dim,
		span: axis.dim === 'y' ? [rect.y, rect.y + rect.height] : [rect.x, rect.x + rect.width],
		min,
		max,
		log: axis.type === 'log',
		reversed: axis.inverse === true,
		title: axis.model.get('show') === false ? '' : (axis.model.get('name') ?? ''),
		color: data.getVisual('style')[data.getVisual('drawType')],
		fromZero
	};
}

/** The chart title echarts draws: its text unless hidden. */
function echartsTitle(chart) {
	const component = chart.getModel().getComponent('title');
	return component === undefined || component.get('show') === false ? '' : (component.get('text') ?? '');
}

/** The value axes echarts built for its grid series. */
export function builtEcharts(option, browserOutcome, options) {
	const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 300 });
	try {
		chart.setOption(copyPlain(option));
		const series = chart.getModel().getSeries();
		const measured = series.filter((model) => model.coordinateSystem?.type === 'cartesian2d').map(echartsAxis);
		// echarts filters negative pie values out before drawing (`negativeDataFilter`).
		const pieMisdrawn = series
			.filter((model) => model.subType === 'pie')
			.some((model) => model.getData().count() < model.getRawData().count());
		const colors = measured.map(({ color }) => color);
		return {
			bars: measured.filter(({ type }) => type === 'bar'),
			valueAxes: measured,
			pieMisdrawn,
			title: echartsTitle(chart),
			config: option,
			colors,
			described: browserOutcome === undefined ? undefined : browserOutcome.label !== '',
			contrasts: echartsContrasts(chart, colors, options),
			motion: echartsMotion(chart)
		};
	} finally {
		chart.dispose();
	}
}

/** A computed SVG fill that paints nothing. */
const UNPAINTED = new Set(['none', 'transparent', 'rgba(0, 0, 0, 0)']);

/** The y axis each series is on, as the page runner recorded it. */
const highchartsAxes = (series, yAxes) =>
	series
		.filter(({ yAxis }) => yAxis !== null)
		.map(({ type, yAxis, fromZero }) => {
			const { horiz, top, left, len } = yAxes[yAxis];
			return {
				type,
				id: yAxis,
				...yAxes[yAxis],
				dir: horiz ? 'x' : 'y',
				span: horiz ? [left, left + len] : [top, top + len],
				fromZero: fromZero !== false
			};
		});

/** Each cartesian series' contrast with what is behind it, in each scheme whose background is known. */
function highchartsContrasts(series, shades, options) {
	const cartesian = series
		.map(({ type, yAxis }, index) => (type !== 'pie' && yAxis !== null ? index : -1))
		.filter((index) => index >= 0);
	// A background that paints nothing shows the page: the one the caller declares for that scheme, if any.
	const page = pageBackground(options);
	const behind = (scheme) => (UNPAINTED.has(shades[scheme].background) ? page?.[scheme] : shades[scheme].background);
	return ['light', 'dark'].flatMap((scheme) =>
		behind(scheme) === undefined
			? []
			: cartesian.map((index) => contrastRatio(shades[scheme].series[index] ?? '', behind(scheme)))
	);
}

/** The y axes Highcharts built for its series (recorded by the page runner). */
export function builtHighcharts({ series, yAxes, title, access, shades, durations }, config, options) {
	const measured = highchartsAxes(series, yAxes);
	// Highcharts leaves negative pie points out (`isValid`: `y >= 0`).
	const pieMisdrawn = series.some(
		({ type, points }) => type === 'pie' && points.some(({ y, valid }) => y !== null && y < 0 && !valid)
	);
	// The harness loads the accessibility module: keyboard focus is there unless the config turns it off.
	return {
		bars: measured.filter(({ type }) => type === 'column' || type === 'bar'),
		valueAxes: measured,
		pieMisdrawn,
		title,
		config,
		colors: series.filter(({ type, yAxis }) => type !== 'pie' && yAxis !== null).map(({ color }) => color),
		described: access.points > 0,
		keyboardOff: !access.keyboard,
		contrasts: highchartsContrasts(series, shades, options),
		motion: { endless: false, longest: Math.max(0, ...durations) }
	};
}
