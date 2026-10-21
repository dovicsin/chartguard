import { validate } from '@chartguard/config-chartjs';
import {
	type ConfigValidator,
	type Diagnostic,
	result,
	type ValidationOptions,
	type ValidationResult
} from '@chartguard/core';

/** When a result was produced: the chart's creation, or an update (`chart.update(mode)`). */
export interface GuardEvent {
	readonly phase: 'create' | 'update';
	readonly mode?: string;
}

export interface GuardOptions {
	/** Replaces the shipped `validate`, e.g. `withExtensions([...])`. */
	readonly validator?: ConfigValidator;
	/** Passed to every validation; `libraryVersion` defaults to the running `Chart.version`. */
	readonly options?: ValidationOptions;
	/** Receives every result; without it, a result with confirmed errors is written with `console.warn`. */
	readonly onResult?: (result: ValidationResult, event: GuardEvent) => void;
	/** An invalid config is not drawn: Chart.js cancels the creation render or the update. */
	readonly block?: boolean;
	/** Validate updates too (default true); creation is always validated. */
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
 * A copy of the plain objects and arrays in `value` as they are now, by property descriptor: data
 * properties are copied, accessors are kept as accessors and never run; anything else is shared.
 */
function snapshot(value: unknown, copies = new Map<object, object>()): unknown {
	if (!isPlain(value)) return value;
	const known = copies.get(value);
	if (known !== undefined) return known;
	const copy: object = Array.isArray(value)
		? (new Array(value.length) as unknown[])
		: (Object.create(Object.getPrototypeOf(value) as object | null) as object);
	copies.set(value, copy);
	for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
		if (Array.isArray(value) && key === 'length') continue;
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

/** The plugin's state for one chart: the snapshot it was created from, and whether that was invalid. */
class Guard {
	private rendered = false;
	private invalidAtCreation = false;
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

	private validationOptions(chart: GuardedChart): ValidationOptions {
		const libraryVersion = this.options.options?.libraryVersion ?? runningVersion(chart);
		return { ...this.options.options, ...(libraryVersion === undefined ? {} : { libraryVersion }) };
	}

	private create(chart: GuardedChart): void {
		const checked = this.validator(this.created, this.validationOptions(chart));
		this.invalidAtCreation = !checked.valid;
		this.report(checked, { phase: 'create' });
	}

	/** The first update renders the creation; later ones are the caller's changes. False cancels the render. */
	private update(chart: GuardedChart, { mode }: { readonly mode?: string }): boolean | undefined {
		if (!this.rendered) {
			this.rendered = true;
			return this.options.block === true && this.invalidAtCreation ? false : undefined;
		}
		if (this.options.updates === false) return undefined;
		const { type, data, options } = chart.config;
		const view = {
			type,
			data,
			options: options === null || typeof options !== 'object' ? options : withProperty(options, 'scales')
		};
		const checked = this.validator(view, this.validationOptions(chart));
		const noted = {
			...checked,
			...result(checked.library, checked.schemaVersion, checked.coverage, [...checked.diagnostics, UNCHECKED])
		};
		this.report(noted, { phase: 'update', ...(mode === undefined ? {} : { mode }) });
		return this.options.block === true && !noted.valid ? false : undefined;
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
