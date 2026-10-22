import { type QualityRule, rule, SOURCES } from './catalog.js';
import { valueOf } from './facts.js';
import { emptyTitle, placeholderText, valueAxisUntitled } from './labels.js';
import { CARTESIAN, configured, measuredAxes } from './measure.js';

/**
 * Bars encode values by their length from zero. The runtimes draw bars from zero while zero is in the
 * axis range (chart.js@4.5.1 `getBaseValue`: `min < 0 && max < 0 ? max : min > 0 && max > 0 ? min : 0`);
 * an axis whose range excludes zero cuts every bar short by the same amount.
 */
const barBaseline = rule(
	{
		id: 'bar-baseline',
		code: 'VIS_BAR_BASELINE',
		severity: 'warning',
		title: 'Bars on an axis that does not include zero',
		rationale:
			'A bar encodes its value by its length from the baseline. When the value axis starts above zero (or ends below it for negative bars), every bar loses the same length, and their ratios no longer match the values: readers overestimate differences.',
		evidence: [SOURCES.pandey2015, SOURCES.correll2020, SOURCES.cleveland1984],
		limits: [
			'Only a range the config sets is read: an axis that leaves zero out because of the data alone (Chart.js `beginAtZero: false`, ECharts `scale: true`) is not reported.',
			'A non-zero baseline can be deliberate when the differences matter more than the magnitudes (for example a narrow band of values far from zero); the finding asks to verify, it does not say the chart is wrong.',
			'Logarithmic axes have no zero; they are reported by `bar-log-scale` instead.'
		]
	},
	(chart, report) => {
		return measuredAxes(chart, ['bar']).flatMap(({ axis }) => {
			if (configured(axis.scale) === 'log') return [];
			const [min, max] = [configured(axis.min), configured(axis.max)];
			if (min === 'data' || (typeof min === 'number' && min > 0))
				return [
					report(
						axis.min.path,
						'Bars are drawn on a value axis that starts above zero, so their lengths are not proportional to their values; verify that the comparison is not misleading.'
					)
				];
			if (typeof max === 'number' && max < 0)
				return [
					report(
						axis.max.path,
						'Bars are drawn on a value axis that ends below zero, so their lengths are not proportional to their values; verify that the comparison is not misleading.'
					)
				];
			return [];
		});
	}
);

const barLogScale = rule(
	{
		id: 'bar-log-scale',
		code: 'VIS_BAR_LOG_SCALE',
		severity: 'warning',
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
		title: 'Series measured on two value axes',
		rationale:
			'With two value scales in one plot, where lines cross and how steep they look depend on how each scale was chosen; readers read crossings and slopes as properties of the data.',
		evidence: [SOURCES.isenberg2011],
		limits: [
			'Quantities in different units need different scales; separate panels sharing the index axis show them without implying a relation.',
			'Only bindings that are known count: a series whose axis is not known is not compared.'
		]
	},
	(chart, report) => {
		// Two axes count only for series known to share an orientation (both vertical, or both horizontal).
		const [first, ...rest] = measuredAxes(chart, CARTESIAN);
		const orientation = first === undefined ? undefined : valueOf(first.by.orientation);
		const second =
			orientation === undefined ? undefined : rest.find(({ by }) => valueOf(by.orientation) === orientation);
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
	placeholderText,
	valueAxisUntitled,
	emptyTitle
];
