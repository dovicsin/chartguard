import { isContainer, ownDataProperty } from '@chartguard/core';
import { type Fact, isString, type Item, type Listed, readFact, unknown } from '@chartguard/quality-core';

export type Axis = 'x' | 'y' | 'r';

/**
 * The scales a chart builds, in the order `chart.scales` holds them (chart.js@4.5.1 `mergeScaleConfig`):
 * the configured ones first, then those the datasets' types add. `axis` is undefined where the config
 * does not say: a scale whose axis is not readable, or in place of scales that cannot be read at all.
 */
export interface Scales {
	readonly entries: readonly { readonly id: string | undefined; readonly axis: Axis | undefined }[];
}

const UNREAD = { id: undefined, axis: undefined } as const;

const AXES = new Set(['x', 'y', 'r']);
const isAxis = (value: unknown): value is Axis => typeof value === 'string' && AXES.has(value);
const POSITIONS: Readonly<Record<string, Axis>> = { top: 'x', bottom: 'x', left: 'y', right: 'y' };

/** A dataset's scale ids and the axes they are on, as its type adds them; undefined when not readable. */
export type DatasetScales = (item: Item) => readonly { readonly id: string; readonly axis: Axis }[] | undefined;

/** An own string data property, or undefined (also for a getter, which never runs). */
function own(value: unknown, key: string): unknown {
	if (!isContainer(value)) return undefined;
	const entry = ownDataProperty(value, key);
	return entry.found ? entry.value : undefined;
}

/** The axis a dataset binds `id` to (`retrieveAxisFromDatasets`: the first dataset naming it, x before y). */
function axisFromDatasets(datasets: Listed<Item>, id: string): Axis | undefined {
	if (!datasets.known) return undefined;
	const bound = datasets.items.find(({ value }) => own(value, 'xAxisID') === id || own(value, 'yAxisID') === id);
	if (bound === undefined) return undefined;
	return own(bound.value, 'xAxisID') === id ? 'x' : 'y';
}

/**
 * The axis of a configured scale (`determineAxis`, dist/chart.js:5261): its id when that is `x`, `y`
 * or `r`; else its `axis`, its `position`, the first letter of a longer id; else the axis a dataset binds
 * it to. Undefined when none says (Chart.js then throws) or one is behind a getter.
 */
function axisOf(id: string, scale: unknown, datasets: Listed<Item>): Axis | undefined {
	if (isAxis(id)) return id;
	const axis = own(scale, 'axis');
	if (isAxis(axis)) return axis;
	const position = own(scale, 'position');
	if (typeof position === 'string' && POSITIONS[position] !== undefined) return POSITIONS[position];
	const letter = id.length > 1 ? id[0]?.toLowerCase() : undefined;
	return isAxis(letter) ? letter : axisFromDatasets(datasets, id);
}

/** Configured scales Chart.js builds: plain objects only (`if (!isObject(scaleConf))` skips the rest). */
const isPlainObject = (value: unknown): boolean => Object.prototype.toString.call(value) === '[object Object]';

/** The configured scales, in key order; an unreadable `options.scales` is one unread entry. */
function configuredScales(config: unknown, datasets: Listed<Item>): Scales['entries'] {
	const configured = readFact(config, ['options', 'scales'], isContainer);
	if (!configured.known) return configured.reason === 'unset' ? [] : [UNREAD];
	return Object.keys(configured.value).flatMap((id) => {
		const scale = ownDataProperty(configured.value, id);
		if (!scale.found) return [{ id, axis: undefined }];
		return isPlainObject(scale.value) ? [{ id, axis: axisOf(id, scale.value, datasets) }] : [];
	});
}

export function scalesOf(config: unknown, datasets: Listed<Item>, added: DatasetScales): Scales {
	const entries = [...configuredScales(config, datasets)];
	if (!datasets.known) return { entries: [...entries, UNREAD] };
	for (const item of datasets.items) {
		const scales = added(item);
		// `scales[id] = scales[id] || …`: a configured or earlier scale keeps its place.
		const fresh = scales?.filter(({ id }) => !entries.some((entry) => entry.id === id));
		entries.push(...(fresh ?? [UNREAD]));
	}
	return { entries };
}

/** Per axis, the line of `linkScales` that defaults a dataset's scale to the first scale on that axis. */
const FIRST_SCALE: Readonly<Record<Axis, string>> = {
	x: "chart.js@4.5.1 dist/chart.js:621 const xid = meta.xAxisID = valueOrDefault(dataset.xAxisID, getFirstScaleId(chart, 'x'));",
	y: "chart.js@4.5.1 dist/chart.js:622 const yid = meta.yAxisID = valueOrDefault(dataset.yAxisID, getFirstScaleId(chart, 'y'));",
	r: "chart.js@4.5.1 dist/chart.js:623 const rid = meta.rAxisID = valueOrDefault(dataset.rAxisID, getFirstScaleId(chart, 'r'));"
};

/**
 * The scale a dataset is measured on along `axis`: the one its `<axis>AxisID` names, else the first
 * scale of the chart on that axis. Unknown when a scale before it might be on that axis.
 */
export function scaleOf(config: unknown, item: Item, axis: Axis, scales: Scales): Fact<string> {
	const named = readFact(config, [...item.segments, `${axis}AxisID`], isString);
	if (named.known || named.reason !== 'unset') return named;
	for (const { id, axis: on } of scales.entries) {
		if (id === undefined || on === undefined) return unknown(named.path, 'unmodelled');
		if (on === axis) return { known: true, value: id, path: named.path, source: 'default', pointer: FIRST_SCALE[axis] };
	}
	// Every dataset adds a scale on each of its axes: one is always found when all are read.
	return unknown(named.path, 'unmodelled');
}
