import { validate } from '@chartguard/config-echarts';
import {
	type ConfigValidator,
	type Diagnostic,
	isContainer,
	isRecord,
	ownDataProperty,
	result,
	type ValidationOptions,
	type ValidationResult
} from '@chartguard/core';

import { type EChartsRuntime, registriesOf } from './registries.js';

/** What `chart.setOption` takes besides the option: `notMerge` as a boolean, or the settings object. */
export type SetOptionSettings =
	| boolean
	| {
			readonly notMerge?: boolean;
			readonly replaceMerge?: string | readonly string[];
			readonly lazyUpdate?: boolean;
			readonly silent?: boolean;
	  };

/** The part of an ECharts instance this path uses. */
export interface EChartsInstance {
	setOption(option: unknown, settings?: unknown): void;
	getOption(): unknown;
}

export interface SetOptionGuard {
	/** Replaces the shipped `validate`, e.g. `withExtensions([...])`. */
	readonly validator?: ConfigValidator;
	/** Passed to every validation: `libraryVersion: echarts.version`, `registries`. */
	readonly options?: ValidationOptions;
	/**
	 * The namespace the chart's runtime registers on (`echarts/core` after `use`, or `echarts`): what it
	 * has registered is read on every call (`registriesOf`). A registry id named in `options` wins.
	 */
	readonly echarts?: EChartsRuntime;
	/** Receives every result; without it, a result with confirmed errors is written with `console.warn`. */
	readonly onResult?: (result: ValidationResult, event: { readonly fresh: boolean }) => void;
	/** An invalid option is not set: the chart keeps what it has. */
	readonly block?: boolean;
}

/** Every host ECharts runs in has a console; the package compiles without DOM or Node types. */
declare const console: { warn(...data: unknown[]): void };

const own = (value: unknown, key: string): unknown => {
	if (!isContainer(value)) return undefined;
	const entry = ownDataProperty(value, key);
	return entry.found ? entry.value : undefined;
};

/**
 * Whether the call sets the series afresh: the chart holds no option yet, `notMerge`, or
 * `replaceMerge` naming `series`. Then echarts looks every series up by its own `type`.
 */
function isFresh(chart: EChartsInstance, settings: SetOptionSettings | undefined): boolean {
	if (chart.getOption() === undefined || settings === true) return true;
	if (!isRecord(settings)) return false;
	const replaced = settings.replaceMerge;
	const names = Array.isArray(replaced) ? replaced : [replaced];
	return settings.notMerge === true || names.includes('series');
}

/** A series list as items with their paths: `series: […]` or a single `series: {…}`. */
function itemsAt(series: unknown, path: string): { item: unknown; path: string }[] {
	if (Array.isArray(series))
		return (series as unknown[]).map((item, index) => ({ item, path: `${path}[${String(index)}]` }));
	return series === undefined ? [] : [{ item: series, path }];
}

/** An item without its own `type` (an accessor is not known, so it claims nothing). */
const untyped = (item: unknown): boolean => isRecord(item) && !Object.hasOwn(item, 'type');

/**
 * echarts drops a series it cannot find a model for by type (echarts@6.1.0 dist/echarts.js:
 * `error("Unknown series " + subType)`): an untyped item of a fresh option, or of a merge beyond the
 * series the chart has when the update names none by `id` or `name`.
 */
function dropped(path: string): Diagnostic {
	return {
		code: 'CFG_REQUIRED',
		severity: 'error',
		confidence: 'certain',
		path: `${path}.type`,
		message: 'This series has no type and no series to merge into: echarts drops it ("Unknown series").'
	};
}

/** The types of the series the chart holds, in order. */
function existingTypes(chart: EChartsInstance): unknown[] {
	const series = own(chart.getOption(), 'series');
	return Array.isArray(series) ? series.map((item) => own(item, 'type')) : [];
}

/** A merge without `id` or `name`: item i merges into the chart's series i. */
const byIndex = (items: readonly { item: unknown }[]): boolean =>
	items.every(({ item }) => own(item, 'id') === undefined && own(item, 'name') === undefined);

/** The option as the merge applies it: each untyped item with the type of the series it merges into. */
function merged(option: unknown, types: readonly unknown[]): unknown {
	const series = own(option, 'series');
	if (!Array.isArray(series) || !isRecord(option)) return option;
	const typed = (series as unknown[]).map((item, index) => {
		const type = types[index];
		if (!untyped(item) || typeof type !== 'string' || !isRecord(item)) return item;
		return Object.defineProperties(
			{},
			{ ...Object.getOwnPropertyDescriptors(item), type: { value: type, enumerable: true } }
		);
	});
	return Object.defineProperties(
		{},
		{ ...Object.getOwnPropertyDescriptors(option), series: { value: typed, enumerable: true } }
	);
}

/** The guard's options with the registry context of `guard.echarts`, read now. */
function optionsOf({ options, echarts }: SetOptionGuard): ValidationOptions | undefined {
	if (echarts === undefined) return options;
	const registries = { ...registriesOf(echarts), ...options?.registries };
	return Object.keys(registries).length === 0 ? options : { ...options, registries };
}

function warn(checked: ValidationResult): void {
	if (checked.valid) return;
	const listed = checked.diagnostics
		.filter(({ severity }) => severity === 'error')
		.map(({ path, message }) => `${path} (${message})`)
		.join('; ');
	console.warn(`ChartGuard: ${checked.library} option invalid: ${listed}`);
}

/** The option as `chart.setOption(option, settings)` would apply it, validated; nothing is set. */
export function checkOption(
	chart: EChartsInstance,
	option: unknown,
	settings?: SetOptionSettings,
	guard: SetOptionGuard = {}
): ValidationResult {
	const validator = guard.validator ?? validate;
	const options = optionsOf(guard);
	const fresh = isFresh(chart, settings);
	const series = itemsAt(own(option, 'series'), '$.series');
	const based = itemsAt(own(own(option, 'baseOption'), 'series'), '$.baseOption.series');
	let view = option;
	let missing: Diagnostic[];
	if (fresh) missing = [...series, ...based].filter(({ item }) => untyped(item)).map(({ path }) => dropped(path));
	else if (byIndex(series)) {
		const types = existingTypes(chart);
		view = merged(option, types);
		missing = series
			.filter(({ item }, index) => untyped(item) && index >= types.length)
			.map(({ path }) => dropped(path));
	} else missing = [];
	// A merge update is partial by design: what it leaves out, the chart already has.
	const checked = validator(view, fresh ? options : { ...options, incomplete: true });
	return {
		...checked,
		...result(checked.library, checked.schemaVersion, checked.coverage, [...checked.diagnostics, ...missing])
	};
}

/**
 * The safe `setOption` path (CG-04-03): the option is validated as the call applies it to this chart,
 * reported, then set with its settings unless `block` and invalid. Nothing is patched.
 */
export function setOption(
	chart: EChartsInstance,
	option: unknown,
	settings?: SetOptionSettings,
	guard: SetOptionGuard = {}
): ValidationResult {
	const fresh = isFresh(chart, settings);
	const checked = checkOption(chart, option, settings, guard);
	if (guard.onResult === undefined) warn(checked);
	else guard.onResult(checked, { fresh });
	if (guard.block !== true || checked.valid) chart.setOption(option, settings);
	return checked;
}
