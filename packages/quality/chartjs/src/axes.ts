import {
	type AxisSemantics,
	type Default,
	type Fact,
	firstSet,
	formatPath,
	isBoolean,
	isNumber,
	isString,
	type Listed,
	readFact,
	type ScaleType,
	type SeriesSemantics
} from '@chartguard/quality-core';

import type { Axis, Scales } from './scales.js';
import { INDEX_AXIS } from './series.js';

/** Bar and line charts default their index scale to `category` and their value scale to `linear`. */
const BY_ROLE: Readonly<Record<string, { readonly index: Default<string>; readonly value: Default<string> }>> = {
	bar: {
		index: { value: 'category', pointer: "chart.js@4.5.1 dist/chart.js:1393 type: 'category'," },
		value: { value: 'linear', pointer: "chart.js@4.5.1 dist/chart.js:1400 type: 'linear'," }
	},
	line: {
		index: { value: 'category', pointer: "chart.js@4.5.1 dist/chart.js:2097 type: 'category'" },
		value: { value: 'linear', pointer: "chart.js@4.5.1 dist/chart.js:2100 type: 'linear'" }
	}
};
/** Scatter charts default both scales to `linear`, radar charts their `r` scale to `radialLinear`. */
const BY_AXIS: Readonly<Record<string, Partial<Record<Axis, Default<string>>>>> = {
	scatter: {
		x: { value: 'linear', pointer: "chart.js@4.5.1 dist/chart.js:2472 type: 'linear'" },
		y: { value: 'linear', pointer: "chart.js@4.5.1 dist/chart.js:2475 type: 'linear'" }
	},
	radar: { r: { value: 'radialLinear', pointer: "chart.js@4.5.1 dist/chart.js:2402 type: 'radialLinear'" } }
};
/** A scale title is hidden and empty unless set (`title: { display: false, text: '' }`). */
const TITLE_SHOWN: Default<boolean> = {
	value: false,
	pointer: 'chart.js@4.5.1 dist/chunks/helpers.dataset.js:956 display: false,'
};
const TITLE_TEXT: Default<string | string[]> = {
	value: '',
	pointer: "chart.js@4.5.1 dist/chunks/helpers.dataset.js:957 text: '',"
};
const REVERSE: Default<boolean> = {
	value: false,
	pointer: 'chart.js@4.5.1 dist/chunks/helpers.dataset.js:934 reverse: false,'
};

const SCALE_TYPES: Readonly<Record<string, ScaleType>> = {
	linear: 'linear',
	radialLinear: 'linear',
	logarithmic: 'log',
	category: 'category',
	time: 'time',
	timeseries: 'time'
};

/** Chart.js titles are a string or one string per line. */
const isText = (value: unknown): value is string | string[] =>
	typeof value === 'string' || (Array.isArray(value) && (value as unknown[]).every((line) => typeof line === 'string'));
export const asText = (fact: Fact<string | string[]>): Fact<string> => {
	if (!fact.known || typeof fact.value === 'string') return fact as Fact<string>;
	return { ...fact, value: fact.value.join(' ') };
};

/**
 * A configured scale's type defaults from the chart type (`mergeScaleConfig` merges the chart type's
 * scale defaults first): by its role for bar and line charts (the index axis is `options.datasets[type]`
 * or `options.indexAxis`, else `x`), by its axis for scatter and radar charts. Otherwise not modelled.
 */
function defaultType(config: unknown, axis: Axis | undefined): Default<string> | undefined {
	const type = readFact(config, ['type'], isString);
	if (!type.known || axis === undefined) return undefined;
	const roles = BY_ROLE[type.value];
	if (roles === undefined) return BY_AXIS[type.value]?.[axis];
	const index = firstSet(
		[
			readFact(config, ['options', 'datasets', type.value, 'indexAxis'], isString),
			readFact(config, ['options', 'indexAxis'], isString)
		],
		INDEX_AXIS
	);
	if (!index.known || axis === 'r') return undefined;
	return axis === index.value ? roles.index : roles.value;
}

function scaleOf(config: unknown, path: readonly string[], axis: Axis | undefined): Fact<ScaleType> {
	const type = readFact(config, [...path, 'type'], isString, defaultType(config, axis));
	if (!type.known) return type;
	return { ...type, value: SCALE_TYPES[type.value] ?? 'other' };
}

function axisOf(config: unknown, key: string, axis: Axis | undefined): AxisSemantics {
	const path = ['options', 'scales', key];
	return {
		key,
		path: formatPath(path),
		scale: scaleOf(config, path, axis),
		min: readFact(config, [...path, 'min'], isNumber),
		max: readFact(config, [...path, 'max'], isNumber),
		reversed: readFact(config, [...path, 'reverse'], isBoolean, REVERSE),
		title: {
			text: asText(readFact(config, [...path, 'title', 'text'], isText, TITLE_TEXT)),
			shown: readFact(config, [...path, 'title', 'display'], isBoolean, TITLE_SHOWN)
		}
	};
}

/** Every scale the chart builds that is read (configured or added by a dataset), and any a dataset names. */
export function axesOf(config: unknown, series: Listed<SeriesSemantics>, scales: Scales): AxisSemantics[] {
	const built = scales.entries.flatMap(({ id, axis }) => (id === undefined ? [] : [[id, axis] as const]));
	const named = series.known ? series.items.flatMap(({ valueAxis }) => (valueAxis.known ? [valueAxis.value] : [])) : [];
	const axes = new Map<string, Axis | undefined>(built);
	for (const key of named) if (!axes.has(key)) axes.set(key, undefined);
	return [...axes].map(([key, axis]) => axisOf(config, key, axis));
}
