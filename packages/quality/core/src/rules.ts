import { dataNotDescribed, keyboardDisabled } from './access.js';
import { type QualityRule, rule, SOURCES } from './catalog.js';
import type { AxisSemantics, ChartSemantics } from './chart.js';
import { lowContrastSeries, sameColorSeries } from './colors.js';
import { valueOf } from './facts.js';
import { dataRange } from './fit.js';
import { emptyTitle, placeholderText, valueAxisUntitled } from './labels.js';
import { CARTESIAN, configured, measuredAxes } from './measure.js';
import { longMotion } from './motion.js';
import { percentWithoutUnit } from './units.js';

/**
 * Bars encode values by their length from zero. The runtimes draw bars from zero while zero is in the
 * axis range (chart.js@4.5.1 `getBaseValue`: `min < 0 && max < 0 ? max : min > 0 && max > 0 ? min : 0`);
 * an axis whose range excludes zero cuts every bar short by the same amount, and so does a bar base
 * other than zero (Chart.js `base`, ECharts `startValue`, Highcharts `threshold`).
 */

/**
 * Where an axis bound set to the data (`'data'`, ECharts `dataMin`/`dataMax`) lies: at the smallest
 * (or largest) value of the series on the axis. Undefined when those values are not known (H8).
 */
function dataBound(chart: ChartSemantics, axis: AxisSemantics, end: 0 | 1): number | undefined {
	const range = dataRange(chart.series, axis.key, axis.path);
	return range.known ? range.value[end] : undefined;
}

/** A bound as a number: the configured one, or for `'data'` the data's own bound (unknown when the data is). */
function boundValue(chart: ChartSemantics, axis: AxisSemantics, end: 0 | 1): number | undefined {
	const bound = configured(end === 0 ? axis.min : axis.max);
	return bound === 'data' ? dataBound(chart, axis, end) : bound;
}

/** The finding on an axis: a range the config sets, or one fitted to the data, that leaves zero out. */
function cutAxis(chart: ChartSemantics, axis: AxisSemantics): { path: string; message: string } | undefined {
	const [min, max] = [boundValue(chart, axis, 0), boundValue(chart, axis, 1)];
	if (min !== undefined && min > 0)
		return {
			path: axis.min.path,
			message:
				'Bars are drawn on a value axis that starts above zero, so their lengths are not proportional to their values; verify that the comparison is not misleading.'
		};
	if (typeof max === 'number' && max < 0)
		return {
			path: axis.max.path,
			message:
				'Bars are drawn on a value axis that ends below zero, so their lengths are not proportional to their values; verify that the comparison is not misleading.'
		};
	if (configured(axis.fit) === 'excluded')
		return {
			path: axis.fit.path,
			message:
				'The value axis fits its range to the data, and for these values the range leaves zero out at every chart size: bar lengths are not proportional to their values; verify that the comparison is not misleading.'
		};
	return undefined;
}

const barBaseline = rule(
	{
		id: 'bar-baseline',
		code: 'VIS_BAR_BASELINE',
		severity: 'warning',
		impact: 'misleads',
		context: [],
		fix: {
			offered: true,
			edit: 'Sets the configured minimum, maximum or base to 0, or turns a range fitted to the data back to one that includes zero (Chart.js `beginAtZero: true`, ECharts `scale: false`).'
		},
		title: 'Bars that do not grow from zero',
		rationale:
			'A bar encodes its value by its length from the baseline. When the value axis starts above zero (or ends below it for negative bars), or the bars grow from another value, every bar loses the same length, and their ratios no longer match the values: readers overestimate differences.',
		evidence: [SOURCES.pandey2015, SOURCES.correll2020, SOURCES.cleveland1984],
		limits: [
			"A range fitted to the data (Chart.js `beginAtZero: false`, ECharts `scale: true`) is reported only when the runtime's tick algorithm leaves zero out at every chart size; where it depends on the size, nothing is claimed. Highcharts ranges fitted to the data (`threshold: null`, `softThreshold: false`) depend on the size and are not reported.",
			'A non-zero baseline can be deliberate when the differences matter more than the magnitudes (for example a narrow band of values far from zero); the finding asks to verify, it does not say the chart is wrong.',
			'Logarithmic axes have no zero; they are reported by `bar-log-scale` instead.'
		]
	},
	(chart, report) => {
		const measured = measuredAxes(chart, ['bar']).filter(({ axis }) => configured(axis.scale) !== 'log');
		const axes = measured.flatMap(({ axis }) => {
			const cut = cutAxis(chart, axis);
			return cut === undefined ? [] : [report(cut.path, cut.message)];
		});
		// A base the config sets, once per place it is set (an ECharts axis `startValue` serves all its bars).
		const linear = new Set(measured.map(({ axis }) => axis.key));
		const bases = new Map<string, number>();
		if (chart.series.known)
			for (const { kind, valueAxis, base } of chart.series.items) {
				const [value, key] = [configured(base), valueOf(valueAxis)];
				if (valueOf(kind) === 'bar' && key !== undefined && linear.has(key) && value !== undefined && value !== 0)
					bases.set(base.path, value);
			}
		return [
			...axes,
			...[...bases].map(([path, value]) =>
				report(
					path,
					`Bars grow from ${String(value)}, not from zero, so their lengths are not proportional to their values; verify that the comparison is not misleading.`
				)
			)
		];
	}
);

const barLogScale = rule(
	{
		id: 'bar-log-scale',
		code: 'VIS_BAR_LOG_SCALE',
		severity: 'warning',
		impact: 'misleads',
		context: [],
		fix: {
			offered: true,
			edit: 'Sets the axis type to linear (Chart.js and Highcharts `linear`, ECharts `value`). Values far apart may then make the smallest bars too short to see.'
		},
		title: 'Bars on a logarithmic axis',
		rationale:
			'A logarithmic axis has no zero, so a bar starts at an arbitrary value and its length encodes the logarithm of its value relative to that start, while readers judge bars by length as the value itself.',
		evidence: [SOURCES.cleveland1984],
		limits: [
			'Data spanning orders of magnitude may need a logarithmic scale; points or lines on it, or a note on the scale, avoid the length reading.',
			'Only a scale type the config sets is read.'
		]
	},
	(chart, report) => {
		return measuredAxes(chart, ['bar'])
			.filter(({ axis }) => configured(axis.scale) === 'log')
			.map(({ axis }) =>
				report(
					axis.scale.path,
					'Bars are drawn on a logarithmic axis: their lengths do not encode their values; consider points or lines, or a linear axis.'
				)
			);
	}
);

const reversedValueAxis = rule(
	{
		id: 'reversed-value-axis',
		code: 'VIS_REVERSED_VALUE_AXIS',
		severity: 'warning',
		impact: 'misleads',
		context: [],
		fix: { offered: true, edit: 'Turns the reversal off.' },
		title: 'A reversed value axis',
		rationale:
			'Readers expect larger values higher (or further right). An inverted value axis turns a rise into a fall; in experiments it reversed the message readers took from the chart.',
		evidence: [SOURCES.pandey2015],
		limits: [
			'Some measures are conventionally drawn downwards (depth, rank, position in a list); there the reversal is intended and should be labelled.',
			'Only a reversal the config sets is read; an axis the runtime reverses on its own (Highcharts category axes of inverted charts) is not a value axis.'
		]
	},
	(chart, report) => {
		return measuredAxes(chart, CARTESIAN)
			.filter(({ axis }) => configured(axis.reversed) === true)
			.map(({ axis }) =>
				report(
					axis.reversed.path,
					'The value axis is reversed: larger values are drawn lower (or further left); make sure readers cannot misread the direction.'
				)
			);
	}
);

const dualAxis = rule(
	{
		id: 'dual-axis',
		code: 'VIS_DUAL_AXIS',
		severity: 'info',
		impact: 'risks',
		context: [],
		fix: {
			offered: false,
			why: "Quantities in different units need their own scales; separate panels are a layout one chart's config cannot express, and merging the axes would mislead."
		},
		title: 'Series measured on two value axes',
		rationale:
			'With two value scales in one plot, where lines cross and how steep they look depend on how each scale was chosen; readers read crossings and slopes as properties of the data.',
		evidence: [SOURCES.isenberg2011],
		limits: [
			'Quantities in different units need different scales; separate panels sharing the index axis show them without implying a relation.',
			'Only bindings that are known count: a series whose axis is not known is not compared.',
			'Only axes known to span one panel count: axes in separate panels (Chart.js scales in a `stack`, ECharts grids, Highcharts axes placed with `top`/`height`) are separate charts; axes placed differently are never assumed to overlap.'
		]
	},
	(chart, report) => {
		// Two axes count only for series known to share an orientation (both vertical, or both horizontal),
		// on axes known to span one panel: axes in separate grids, bands or panes are separate charts (H9).
		const [first, ...rest] = measuredAxes(chart, CARTESIAN);
		const orientation = first === undefined ? undefined : valueOf(first.by.orientation);
		const panel = first === undefined ? undefined : valueOf(first.axis.panel);
		const second =
			orientation === undefined || panel === undefined
				? undefined
				: rest.find(({ by, axis }) => valueOf(by.orientation) === orientation && valueOf(axis.panel) === panel);
		return second === undefined
			? []
			: [
					report(
						second.by.valueAxis.path,
						'Series are measured on two value axes in one plot: crossings and slopes depend on how each axis is scaled; consider separate panels.'
					)
				];
	}
);

/**
 * A pie shows each value as its share of the whole. No runtime can show a negative share: chart.js
 * draws its absolute value (`TAU * (Math.abs(value) / total)`, dist/chart.js:2022), echarts drops it
 * (`negativeDataFilter`, dist/echarts.js:48014), highcharts leaves it out of the total and the pie
 * (`isNumber(this.y) && this.y >= 0`, highcharts.src.js:46534).
 */
const pieNegative = rule(
	{
		id: 'pie-negative',
		code: 'VIS_PIE_NEGATIVE',
		severity: 'warning',
		impact: 'misleads',
		context: [],
		fix: { offered: false, why: "The data, or the chart type, has to change; which one is the author's choice." },
		title: 'A negative value in a pie',
		rationale:
			'A pie shows each value as its share of a whole, and readers judge the slices as proportions. A negative value is not a share: the runtimes draw it as a positive slice or leave it out, so the slices no longer show the data.',
		evidence: [SOURCES.spence1991],
		limits: [
			'Only values read from the config are checked; data from an ECharts dataset, Chart.js custom parsing keys or Highcharts `keys` is not read.',
			'The finding points at the smallest value; every negative value of the series is affected.'
		]
	},
	(chart, report) => {
		if (!chart.series.known) return [];
		return chart.series.items.flatMap(({ kind, values }) => {
			const min = valueOf(kind) === 'pie' ? valueOf(values)?.min : undefined;
			return min !== undefined && min.value < 0
				? [
						report(
							min.path,
							'A pie cannot show a negative value as a share of the whole: the runtime draws it as a positive slice or leaves it out.'
						)
					]
				: [];
		});
	}
);

export const QUALITY_RULES: readonly QualityRule[] = [
	barBaseline,
	barLogScale,
	reversedValueAxis,
	dualAxis,
	pieNegative,
	sameColorSeries,
	lowContrastSeries,
	placeholderText,
	valueAxisUntitled,
	emptyTitle,
	percentWithoutUnit,
	dataNotDescribed,
	keyboardDisabled,
	longMotion
];
