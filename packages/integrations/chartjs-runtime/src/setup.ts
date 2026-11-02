import { ownDataProperty } from '@chartguard/core';

import { ownValue } from './registries.js';

/** Every host Chart.js runs in has a console; the package compiles without DOM or Node types. */
declare const console: { warn(...data: unknown[]): void };

/**
 * The caller's inline plugins (`config.plugins`, read without getters). The guard adds itself to them;
 * when it cannot without dropping them or running a getter, `guard()` refuses the config (A49).
 */
export function inlinePlugins(config: object): readonly unknown[] {
	const plugins = ownDataProperty(config, 'plugins');
	if (!plugins.found && plugins.accessor)
		throw new TypeError(
			'ChartGuard: config.plugins is an accessor, so guard() cannot add its plugin without running it or dropping yours. Pass the plugins as a data property.'
		);
	const value = plugins.found ? plugins.value : undefined;
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value))
		throw new TypeError('ChartGuard: config.plugins is not an array, so guard() cannot add its plugin to it.');
	return value;
}

/** `list` with `item` appended, by descriptor: an element behind a getter stays one and never runs. */
export function appended(list: readonly unknown[], item: unknown): unknown[] {
	// An array's `length` is always a data property.
	const { length: _length, ...elements } = Object.getOwnPropertyDescriptors(list) as Record<string, PropertyDescriptor>;
	const copy = Object.defineProperties([], elements) as unknown[];
	copy.length = list.length;
	copy.push(item);
	return copy;
}

/** What turns the guard off in Chart.js, read without getters (a getter's value is not known: no claim). */
function disabledBy(config: object): string | undefined {
	const plugins = ownValue(ownValue(config, 'options'), 'plugins');
	if (plugins === false) return 'options.plugins is false';
	return ownValue(plugins, 'chartguard') === false ? 'options.plugins.chartguard is false' : undefined;
}

/**
 * A config with which Chart.js never calls the guard is not passed silently: it is warned, and with
 * `block` refused, since nothing could be blocked.
 */
export function checkEnabled(config: object, block: boolean): void {
	const cause = disabledBy(config);
	if (cause === undefined) return;
	const message = `ChartGuard: ${cause}, so Chart.js calls none of the guard's hooks: this chart is neither checked nor blocked.`;
	if (block) throw new TypeError(`${message} The guard cannot block it.`);
	console.warn(message);
}

/**
 * The running Chart.js version: `version` of the chart's class or the class it extends (`Chart.version`
 * is a static data property), read along the prototype chain through data properties only.
 */
export function runningVersion(constructor: unknown): string | undefined {
	let target = constructor;
	for (let depth = 0; depth < 64 && (typeof target === 'function' || typeof target === 'object'); depth += 1) {
		if (target === null) return undefined;
		const version = ownDataProperty(target, 'version');
		if (version.found) return typeof version.value === 'string' ? version.value : undefined;
		if (version.accessor) return undefined;
		target = Object.getPrototypeOf(target);
	}
	return undefined;
}
