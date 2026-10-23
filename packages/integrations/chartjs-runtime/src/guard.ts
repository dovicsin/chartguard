import { validate } from '@chartguard/config-chartjs';
import {
	type ConfigValidator,
	type Diagnostic,
	result,
	type ValidationOptions,
	type ValidationResult
} from '@chartguard/core';

import { registriesOf } from './registries.js';

/** When a result was produced: the chart's creation, or an update (`chart.update(mode)`). */
export interface GuardEvent {
	readonly phase: 'create' | 'update';
	readonly mode?: string;
}

export interface GuardOptions {
	/** Replaces the shipped `validate`, e.g. `withExtensions([...])`. */
	readonly validator?: ConfigValidator;
	/**
	 * Passed to every validation. `libraryVersion` defaults to the running `Chart.version`, and
	 * `registries` to what `Chart.registry` holds (`registriesOf`); a registry id named here replaces the read one.
	 */
	readonly options?: ValidationOptions;
	/** Receives every result; without it, a result with confirmed errors is written with `console.warn`. */
	readonly onResult?: (result: ValidationResult, event: GuardEvent) => void;
	/**
	 * An invalid config is not drawn: Chart.js cancels the render. A chart created invalid stays undrawn
	 * at every render while its scales are those it was created with and the rest is still invalid.
	 */
	readonly block?: boolean;
	/** Validate updates too (default true); creation is always validated. Without it, updates are drawn unchecked. */
	readonly updates?: boolean;
}

/** What Chart.js hands a plugin: the chart, whose `config` holds the type, data and options it renders. */
interface GuardedChart {
	readonly config: { readonly type?: unknown; readonly data?: unknown; readonly options?: unknown };
}

/** The plugin `guard` adds: Chart.js's plugin shape, with the two lifecycle hooks it uses. */
export interface GuardPlugin {
	readonly id: 'chartguard';
	beforeInit(chart: GuardedChart): void;
	beforeUpdate(chart: GuardedChart, args: { readonly mode?: string }): boolean | undefined;
}

const isPlain = (value: unknown): value is object => {
	if (typeof value !== 'object' || value === null) return false;
	const prototype: unknown = Object.getPrototypeOf(value);
	// A plain object of any realm: its prototype is null or that realm's Object.prototype.
	return prototype === null || Object.getPrototypeOf(prototype) === null || Array.isArray(value);
};

/**
 * A copy of the plain objects in `value` as they are now, by property descriptor: data properties are
 * copied, accessors are kept as accessors and never run; anything else is shared. Arrays are shared,
 * not copied: between `guard()` and `beforeInit` Chart.js writes only into objects (chart.js@4.5.1
 * `initConfig`: `config.data`, `data.datasets`/`data.labels` when missing, `config.options`,
 * `options.plugins`, `options.scales`; `mergeScaleConfig` merges into new objects), never into an
 * array, so a shared array still holds what the caller passed, and the copy costs nothing per data
 * point (CG-04-06).
 */
function snapshot(value: unknown, copies = new Map<object, object>()): unknown {
	if (!isPlain(value) || Array.isArray(value)) return value;
	const known = copies.get(value);
	if (known !== undefined) return known;
	const copy = Object.create(Object.getPrototypeOf(value) as object | null) as object;
	copies.set(value, copy);
	for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
		const copied = 'value' in descriptor ? { ...descriptor, value: snapshot(descriptor.value, copies) } : descriptor;
		Object.defineProperty(copy, key, copied);
	}
	return copy;
}

/** `object` with `key` replaced or removed, by descriptor: no getter of the caller's runs. */
function withProperty(object: object, key: string, value?: unknown): Record<string, unknown> {
	const descriptors = Object.getOwnPropertyDescriptors(object);
	const { [key]: _replaced, ...rest } = descriptors;
	const copy = Object.defineProperties({}, rest) as Record<string, unknown>;
	if (value !== undefined)
		Object.defineProperty(copy, key, { value, enumerable: true, writable: true, configurable: true });
	return copy;
}

/** The running Chart.js version, from the chart's constructor (`Chart.version`), if it has one. */
function runningVersion(chart: GuardedChart): string | undefined {
	const version: unknown = Object.getOwnPropertyDescriptor(chart.constructor, 'version')?.value;
	return typeof version === 'string' ? version : undefined;
}

/** Every host Chart.js runs in has a console; the package compiles without DOM or Node types. */
declare const console: { warn(...data: unknown[]): void };

const UNCHECKED: Diagnostic = {
	code: 'CFG_UNCHECKED',
	severity: 'info',
	confidence: 'unknown',
	path: '$.options.scales',
	message:
		'Chart.js merges scale options with their defaults before an update; they are checked when the chart is created.'
};

function warn(checked: ValidationResult, { phase }: GuardEvent): void {
	if (checked.valid) return;
	const errors = checked.diagnostics.filter(({ severity }) => severity === 'error');
	const listed = errors.map(({ path, message }) => `${path} (${message})`).join('; ');
	console.warn(
		`ChartGuard: ${checked.library} config invalid at ${phase === 'create' ? 'creation' : 'update'}: ${listed}`
	);
}

/** Whether `path` names the scale options or something inside them (`$.options.scales…`). */
const onScales = (path: string): boolean =>
	path === '$.options.scales' || path.startsWith('$.options.scales.') || path.startsWith('$.options.scales[');

/**
 * Whether two values hold the same options: plain objects and arrays compared by their own data
 * properties (accessors by identity, never run), anything else by identity. Bounded by `seen` for cycles.
 */
function sameOptions(left: unknown, right: unknown, seen = new Set<object>()): boolean {
	if (Object.is(left, right)) return true;
	if (!isPlain(left) || !isPlain(right) || Array.isArray(left) !== Array.isArray(right) || seen.has(left)) return false;
	seen.add(left);
	const [a, b] = [Object.getOwnPropertyDescriptors(left), Object.getOwnPropertyDescriptors(right)];
	const keys = Object.keys(a);
	if (keys.length !== Object.keys(b).length) return false;
	return keys.every((key) => {
		const [x, y] = [a[key], b[key]];
		if (x === undefined || y === undefined) return false;
		if (!('value' in x) || !('value' in y)) return x.get === y.get && x.set === y.set;
		return sameOptions(x.value, y.value, seen);
	});
}

/** A copy of plain options as they are now (data properties copied, accessors kept and never run), for `sameOptions`. */
function frozenCopy(value: unknown, copies = new Map<object, unknown>()): unknown {
	if (!isPlain(value)) return value;
	const known = copies.get(value);
	if (known !== undefined) return known;
	const copy: object = Array.isArray(value)
		? []
		: (Object.create(Object.getPrototypeOf(value) as object | null) as object);
	copies.set(value, copy);
	for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value)))
		Object.defineProperty(
			copy,
			key,
			'value' in descriptor ? { ...descriptor, value: frozenCopy(descriptor.value, copies) } : descriptor
		);
	return copy;
}

/** The scale options a chart renders with (Chart.js merges them into `config.options.scales`). */
function scalesOf(chart: GuardedChart): unknown {
	const { options } = chart.config;
	return isPlain(options) ? Object.getOwnPropertyDescriptor(options, 'scales')?.value : undefined;
}

/** What the guard knows about one chart: its creation verdict, and the scales it was first rendered with. */
interface ChartState {
	readonly created: ValidationResult;
	/** The scale options as Chart.js resolved them at the first render. */
	readonly scales?: { readonly value: unknown };
}

/**
 * The plugin's state, per chart (CG-04-02, A46): a config may build several charts, and a destroyed
 * chart's successor is a new chart. Scale options are checked when a chart is created: at an update
 * Chart.js has merged them with their defaults. While they are still those the chart was first
 * rendered with, the creation's findings on them stand (with `block`, an invalid chart stays undrawn);
 * once they changed they are not checked (`CFG_UNCHECKED`), never assumed valid or invalid.
 */
class Guard {
	private readonly charts = new WeakMap<object, ChartState>();
	private readonly validator: ConfigValidator;
	private readonly report: (result: ValidationResult, event: GuardEvent) => void;

	constructor(
		private readonly created: unknown,
		private readonly options: GuardOptions
	) {
		this.validator = options.validator ?? validate;
		this.report = options.onResult ?? warn;
	}

	plugin(): GuardPlugin {
		return {
			id: 'chartguard',
			beforeInit: (chart) => {
				this.create(chart);
			},
			beforeUpdate: (chart, args) => this.update(chart, args)
		};
	}

	/**
	 * The caller's options with what the running Chart.js says, read now: `Chart.version` and what
	 * `Chart.registry` holds plus the config's inline plugins (`registriesOf`). What the caller names wins.
	 */
	private validationOptions(chart: GuardedChart): ValidationOptions {
		const libraryVersion = this.options.options?.libraryVersion ?? runningVersion(chart);
		const inline: unknown = isPlain(this.created)
			? Object.getOwnPropertyDescriptor(this.created, 'plugins')?.value
			: undefined;
		const registries = {
			...registriesOf(chart.constructor as { readonly registry?: unknown }, inline),
			...this.options.options?.registries
		};
		return {
			...this.options.options,
			...(libraryVersion === undefined ? {} : { libraryVersion }),
			...(Object.keys(registries).length === 0 ? {} : { registries })
		};
	}

	private create(chart: GuardedChart): void {
		const checked = this.validator(this.created, this.validationOptions(chart));
		this.charts.set(chart, { created: checked });
		this.report(checked, { phase: 'create' });
	}

	/** Records the scales at the chart's first render; whether this is that render. */
	private firstRender(chart: GuardedChart, state: ChartState): boolean {
		if (state.scales !== undefined) return false;
		this.charts.set(chart, { ...state, scales: { value: frozenCopy(scalesOf(chart)) } });
		return true;
	}

	/** What is known about the scales at this update: the creation's findings while they are unchanged, else unchecked. */
	private scaleFindings(chart: GuardedChart, { created, scales }: ChartState): readonly Diagnostic[] {
		return scales !== undefined && sameOptions(scales.value, scalesOf(chart))
			? created.diagnostics.filter(({ path }) => onScales(path))
			: [UNCHECKED];
	}

	/** False (cancel the render) when blocking and the result is invalid. */
	private blocks({ valid }: ValidationResult): false | undefined {
		return this.options.block === true && !valid ? false : undefined;
	}

	/** The chart's own config at this update, validated, with what is known about its scales. */
	private checkUpdate(chart: GuardedChart, state: ChartState): ValidationResult {
		const { type, data, options } = chart.config;
		const view = {
			type,
			data,
			options: options === null || typeof options !== 'object' ? options : withProperty(options, 'scales')
		};
		const checked = this.validator(view, this.validationOptions(chart));
		const scales = this.scaleFindings(chart, state);
		return {
			...checked,
			...result(checked.library, checked.schemaVersion, checked.coverage, [...checked.diagnostics, ...scales])
		};
	}

	/**
	 * Every render goes through here, the creation's included (in a browser Chart.js renders once on
	 * attach before its own first update). False cancels the render.
	 */
	private update(chart: GuardedChart, { mode }: { readonly mode?: string }): boolean | undefined {
		const state = this.charts.get(chart);
		if (state === undefined) return undefined;
		if (this.firstRender(chart, state)) return this.blocks(state.created);
		if (this.options.updates === false) return undefined;
		const noted = this.checkUpdate(chart, state);
		this.report(noted, { phase: 'update', ...(mode === undefined ? {} : { mode }) });
		return this.blocks(noted);
	}
}

/**
 * The config with a `chartguard` plugin added (CG-04-02): pass it to `new Chart`. The config is
 * validated as given here when the chart is created, and the chart's own config at every update.
 * The caller's object is not changed, Chart.js is not patched, and no getter of the config runs.
 */
export function guard<T extends object>(config: T, options: GuardOptions = {}): T {
	const plugins: unknown = Object.getOwnPropertyDescriptor(config, 'plugins')?.value;
	const own: unknown[] = Array.isArray(plugins) ? plugins : [];
	const created = snapshot(config);
	return withProperty(config, 'plugins', [...own, new Guard(created, options).plugin()]) as T;
}
