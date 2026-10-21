import { type Diagnostic, isContainer, isRecord, ownDataProperty, type OwnProperty } from '@chartguard/core';

/** The part of a Highcharts series this path reads: its type, collection and options. */
export interface HighchartsSeries {
	readonly type?: unknown;
	readonly coll?: unknown;
	readonly userOptions?: unknown;
	readonly options?: unknown;
}

/** The part of a Highcharts chart this path uses. */
export interface HighchartsChart {
	readonly series: readonly HighchartsSeries[];
	readonly options?: unknown;
	get(id: unknown): unknown;
	update(options: unknown, redraw?: boolean, oneToOne?: boolean, animation?: unknown): void;
	addSeries(options: unknown, redraw?: boolean, animation?: unknown): unknown;
}

const MISSING: OwnProperty = { found: false, accessor: false };
const read = (value: unknown, key: string): OwnProperty => (isContainer(value) ? ownDataProperty(value, key) : MISSING);
/** Highcharts' `defined`: neither `undefined` nor `null`. */
const defined = (property: OwnProperty): boolean =>
	property.found && property.value !== undefined && property.value !== null;
/** Read through an accessor: present, but not known. */
const viaAccessor = (property: OwnProperty): boolean => !property.found && property.accessor;
/** A value read through an accessor is not known: `undefined`, kept apart from a missing one by `accessor`. */
const known = (property: OwnProperty): unknown => (property.found ? property.value : undefined);

/** What an item of `chart.update({ series })` reaches. */
type Reached =
	| { readonly kind: 'series'; readonly series: HighchartsSeries }
	| { readonly kind: 'none' }
	| { readonly kind: 'other' }
	| { readonly kind: 'unknown' };
const NONE: Reached = { kind: 'none' };
const OTHER: Reached = { kind: 'other' };
const UNKNOWN: Reached = { kind: 'unknown' };

/** `chart.get(id)`: any chart item with that id; one that is not a series is not updated. */
function byId(chart: HighchartsChart, id: unknown): Reached | undefined {
	const found = chart.get(id);
	if (!isContainer(found)) return undefined;
	return (found as HighchartsSeries).coll === 'series' ? { kind: 'series', series: found } : OTHER;
}

/**
 * The series item `index` of an update reaches, as highcharts@13.1.1 `Chart#update` matches it
 * (highcharts.src.js, `collectionsWithUpdate.forEach`): by `id` through `chart.get`, else the series
 * at `index ?? i`, unless the item has an id and that series has another, or the series is internal.
 */
function reachedBy(chart: HighchartsChart, item: object, index: number): Reached {
	const id = ownDataProperty(item, 'id');
	const at = ownDataProperty(item, 'index');
	if (viaAccessor(id) || viaAccessor(at)) return UNKNOWN;
	const hasId = defined(id);
	const matched = hasId ? byId(chart, known(id)) : undefined;
	return matched ?? byIndex(chart, defined(at) ? known(at) : index, hasId);
}

/** `chart.series[position]`, unless the item has an id and that series has another, or it is internal. */
function byIndex(chart: HighchartsChart, position: unknown, hasId: boolean): Reached {
	if (typeof position !== 'number') return UNKNOWN;
	const series = chart.series[position];
	if (series === undefined) return NONE;
	const taken = hasId && defined(read(series.options, 'id'));
	return taken || Boolean(known(read(series.options, 'isInternal'))) ? NONE : { kind: 'series', series };
}

/**
 * The chart type a series without its own takes once the update applied: the update's `chart.type`,
 * else the chart's (`Series#update`, `Chart#initSeries`: `options.type || … || chart.options.chart.type`).
 */
export function chartTypeOf(chart: HighchartsChart, options: unknown): OwnProperty {
	const update = read(options, 'chart');
	if (viaAccessor(update)) return update;
	const updated = read(known(update), 'type');
	if (viaAccessor(updated) || defined(updated)) return updated;
	return read(known(read(chart.options, 'chart')), 'type');
}

/** `item` with `type` added, by descriptor: no getter of the caller's runs. */
export function typed(item: unknown, type: OwnProperty): unknown {
	if (!isRecord(item) || typeof known(type) !== 'string') return item;
	// An own type the item has, even one the runtime would skip (`''`), is the caller's to be checked.
	const own = ownDataProperty(item, 'type');
	if (viaAccessor(own) || known(own) !== undefined) return item;
	return Object.defineProperties(
		{},
		{ ...Object.getOwnPropertyDescriptors(item), type: { value: known(type), enumerable: true } }
	);
}

function ignored(path: string, cause: string): Diagnostic {
	return {
		code: 'CFG_INEFFECTIVE',
		severity: 'warning',
		confidence: 'certain',
		path,
		message: `${cause}, so chart.update ignores it.`,
		suggestion: 'Name an existing series by its id, pass oneToOne to add it, or use chart.addSeries.'
	};
}

/** The item as the update applies it (with the type it gets), or the finding that it is ignored. */
function applied(
	chart: HighchartsChart,
	{ item, path, index }: { readonly item: unknown; readonly path: string; readonly index: number },
	{ chartType, oneToOne }: { readonly chartType: OwnProperty; readonly oneToOne: boolean }
): { readonly item: unknown; readonly finding?: Diagnostic } {
	if (!isRecord(item)) return { item };
	const reached = reachedBy(chart, item, index);
	// What the runtime ignores is not checked further: in the view, it is an empty series.
	if (reached.kind === 'other')
		return { item: {}, finding: ignored(path, 'Its id names a chart item that is not a series') };
	if (reached.kind === 'none' && !oneToOne)
		return { item: {}, finding: ignored(path, "It matches none of the chart's series by id or index") };
	if (reached.kind === 'unknown') return { item };
	if (reached.kind === 'none') return { item: typed(item, chartType) };
	const own = read(reached.series.userOptions, 'type');
	return { item: typed(item, viaAccessor(own) || Boolean(known(own)) ? own : chartType) };
}

export interface UpdatePlan {
	/** The options as the update applies them: a single series object as a list of one (Highcharts' `splat`). */
	readonly view: unknown;
	readonly findings: readonly Diagnostic[];
	/** Puts a path of the view back on the caller's options. */
	readonly pathOf: (path: string) => string;
}

const SAME = (path: string): string => path;
const SINGLE = /^\$\.series\[0\](?=$|[.[])/;

/** The update as it applies to `chart`'s series, and what it ignores. */
export function planUpdate(chart: HighchartsChart, options: unknown, oneToOne: boolean): UpdatePlan {
	const series = read(options, 'series');
	if (!isRecord(options) || !series.found || series.value === undefined)
		return { view: options, findings: [], pathOf: SAME };
	const list = Array.isArray(series.value);
	const items = list ? (series.value as unknown[]) : [series.value];
	const context = { chartType: chartTypeOf(chart, options), oneToOne };
	const results = items.map((item, index) =>
		applied(chart, { item, index, path: list ? `$.series[${String(index)}]` : '$.series' }, context)
	);
	const value = results.map(({ item }) => item);
	const view = Object.defineProperties(
		{},
		{ ...Object.getOwnPropertyDescriptors(options), series: { value, enumerable: true } }
	);
	const findings = results.flatMap(({ finding }) => (finding === undefined ? [] : [finding]));
	return { view, findings, pathOf: list ? SAME : (path) => path.replace(SINGLE, '$.series') };
}
