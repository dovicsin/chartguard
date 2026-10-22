import type { QualityReport } from '@chartguard/core';
import {
	type AxisSemantics,
	type ChartSemantics,
	type Default,
	type Fact,
	formatPath,
	isBoolean,
	isNumber,
	isString,
	type Item,
	itemsAt,
	type Listed,
	readFact,
	readPath,
	review,
	type SeriesKind,
	type SeriesSemantics,
	unknown
} from '@chartguard/quality-core';

/** Runtime defaults, each pointing at the line of the pinned chart.js that applies it. */
const DEFAULTS = {
	indexAxis: {
		value: 'x',
		pointer:
			"chart.js@4.5.1 dist/chart.js:5234 return datasetOptions.indexAxis || options.indexAxis || datasetDefaults.indexAxis || 'x';"
	},
	valueAxis: { value: 'y', pointer: "chart.js@4.5.1 dist/chart.js:5323 const id = dataset[axis + 'AxisID'] || axis;" },
	titleShown: { value: false, pointer: 'chart.js@4.5.1 dist/chart.js:8960 display: false,' }
} as const satisfies Record<string, Default<unknown>>;

const KINDS: Readonly<Record<string, SeriesKind>> = {
	bar: 'bar',
	line: 'line',
	scatter: 'scatter',
	bubble: 'scatter',
	pie: 'pie',
	doughnut: 'pie'
};
/** Types drawn on the radial scale `r`: their value axis is not modelled yet. */
const RADIAL = new Set(['radar', 'polarArea']);

/** Chart.js titles are a string or one string per line. */
const isText = (value: unknown): value is string | string[] =>
	typeof value === 'string' || (Array.isArray(value) && (value as unknown[]).every((line) => typeof line === 'string'));
const asText = (fact: Fact<string | string[]>): Fact<string> => {
	if (!fact.known || typeof fact.value === 'string') return fact as Fact<string>;
	return { ...fact, value: fact.value.join(' ') };
};

/** A dataset's type: its own, else the chart's (`const type = dataset.type || config.type`, dist/chart.js:5317). */
function typeOf(config: unknown, item: Item): Fact<string> {
	const own = readFact(config, [...item.segments, 'type'], isString);
	return own.known || own.reason !== 'unset' ? own : readFact(config, ['type'], isString);
}

const kindOf = (type: Fact<string>): Fact<SeriesKind> =>
	type.known ? { ...type, value: KINDS[type.value] ?? 'other' } : type;

/**
 * The axis a dataset's values are measured on. With the index on `x` (the default) it is the `y`
 * scale the dataset names (`yAxisID`, default `y`); a dataset or chart that sets `indexAxis` other
 * than `x` (horizontal bars) is left for CG-05-03.
 */
function valueAxisOf(config: unknown, item: Item, type: Fact<string>): Fact<string> {
	const at = `${item.path}.yAxisID`;
	if (!type.known) return unknown(at, type.reason);
	if (KINDS[type.value] === 'pie') return unknown(at, 'inapplicable');
	if (KINDS[type.value] === undefined || RADIAL.has(type.value)) return unknown(at, 'unmodelled');
	const places = [
		[...item.segments, 'indexAxis'],
		['options', 'datasets', type.value, 'indexAxis'],
		['options', 'indexAxis']
	];
	for (const place of places) {
		const index = readFact(config, place, isString);
		if (!index.known && index.reason !== 'unset') return unknown(at, index.reason);
		if (index.known && index.value !== DEFAULTS.indexAxis.value) return unknown(at, 'unmodelled');
	}
	return readFact(config, [...item.segments, 'yAxisID'], isString, DEFAULTS.valueAxis);
}

function seriesOf(config: unknown, item: Item): SeriesSemantics {
	const type = typeOf(config, item);
	return {
		path: item.path,
		type,
		kind: kindOf(type),
		name: readFact(config, [...item.segments, 'label'], isString),
		valueAxis: valueAxisOf(config, item, type)
	};
}

function axisOf(config: unknown, key: string): AxisSemantics {
	const at = ['options', 'scales', key];
	return {
		key,
		path: formatPath(at),
		min: readFact(config, [...at, 'min'], isNumber),
		max: readFact(config, [...at, 'max'], isNumber),
		title: asText(readFact(config, [...at, 'title', 'text'], isText))
	};
}

/** The configured scales, then every scale a dataset is measured on that is not configured. */
function axesOf(config: unknown, series: Listed<SeriesSemantics>): AxisSemantics[] {
	const scales = readPath(config, ['options', 'scales']);
	const configured = typeof scales === 'object' && scales !== null && !Array.isArray(scales) ? Object.keys(scales) : [];
	const referenced = series.known
		? series.items.flatMap(({ valueAxis }) => (valueAxis.known ? [valueAxis.value] : []))
		: [];
	return [...new Set([...configured, ...referenced])].map((key) => axisOf(config, key));
}

/** The Chart.js config as library-neutral chart semantics (CG-05-02). */
export function normalize(config: unknown): ChartSemantics {
	const datasets = itemsAt(config, ['data', 'datasets']);
	const series: Listed<SeriesSemantics> = datasets.known
		? { ...datasets, items: datasets.items.map((item) => seriesOf(config, item)) }
		: datasets;
	const titleAt = ['options', 'plugins', 'title'];
	return {
		library: 'chartjs',
		title: {
			text: asText(readFact(config, [...titleAt, 'text'], isText)),
			shown: readFact(config, [...titleAt, 'display'], isBoolean, DEFAULTS.titleShown)
		},
		series,
		axes: axesOf(config, series)
	};
}

export function analyze(config: unknown): QualityReport {
	return review(normalize(config));
}
