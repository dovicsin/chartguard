import type { ValidationResult } from '@chartguard/core';

/** One result as the app saw it: when it came, whether it was valid, and its confirmed errors. */
export interface Seen {
	readonly phase: string;
	readonly valid: boolean;
	readonly errors: readonly string[];
}

export const seen = (phase: string, result: ValidationResult): Seen => ({
	phase,
	valid: result.valid,
	errors: result.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.path}`)
});

/** What a page could be left with: its globals, the built-in prototypes and the console. */
function globalState(): string {
	const names = (object: object): string => Object.getOwnPropertyNames(object).sort().join(',');
	const consoleMethods = (['log', 'warn', 'error'] as const).map((method) => String(console[method]));
	return JSON.stringify([names(globalThis), names(Object.prototype), names(Array.prototype), consoleMethods]);
}

/** A box for one chart, sized like a real one. */
export function box(tag: 'div' | 'canvas'): HTMLElement {
	const element = document.createElement(tag);
	element.style.cssText = 'width: 480px; height: 320px';
	document.body.append(element);
	return element;
}

/**
 * Runs the app with the chart library already loaded, then writes what it saw into `#report`
 * (`textContent` only), with whether ChartGuard left any global state behind.
 */
export function runApp(app: () => Record<string, unknown>): void {
	const before = globalState();
	let report: Record<string, unknown>;
	try {
		report = app();
	} catch (error) {
		report = { failed: error instanceof Error ? error.message : String(error) };
	}
	const output = document.createElement('pre');
	output.id = 'report';
	output.textContent = JSON.stringify({ ...report, globalsUnchanged: globalState() === before });
	document.body.append(output);
}
