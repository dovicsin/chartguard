import { type Diagnostic, isContainer, ownDataProperty, suggestion, type ValidationOptions } from '@chartguard/core';

import { confirmed, inconclusive, unresolved } from './diagnostics.js';
import { isListLike, kindOf } from './kind.js';
import { isHandled, type Registries } from './registry.js';
import type { Handler, NodeSchema, SchemaManifest } from './schema.js';
import { type Selection, selectVariant } from './union.js';

const MAX_DEPTH = 40;
const MAX_ENTRIES = 20_000;

interface Cursor {
	readonly path: string;
	readonly depth: number;
}

function descend(cursor: Cursor, segment: string): Cursor {
	return { path: `${cursor.path}${segment}`, depth: cursor.depth + 1 };
}

interface HoleRun {
	readonly first: number;
	readonly last: number;
}

function holeRuns(items: ArrayLike<unknown>, count: number): HoleRun[] {
	const runs: HoleRun[] = [];
	for (let index = 0; index < count; index++) {
		if (ownDataProperty(items, String(index)).found) continue;
		const open = runs.at(-1);
		if (open?.last === index - 1) runs[runs.length - 1] = { first: open.first, last: index };
		else runs.push({ first: index, last: index });
	}
	return runs;
}

function rangeSegment({ first, last }: HoleRun): string {
	return first === last ? `[${String(first)}]` : `[${String(first)}..${String(last)}]`;
}

/**
 * Walks a config against a schema without invoking getters or recursing through cycles.
 * Own-property reads on a Proxy still run its traps; that is the caller's object, not a getter.
 */
export class ConfigWalker {
	readonly diagnostics: Diagnostic[] = [];
	private readonly ancestors = new WeakSet();
	/** The whole config, for defaults the runtime reads from elsewhere in it (`chart.type`). */
	private root: unknown;

	constructor(
		private readonly manifest: SchemaManifest,
		private readonly options: ValidationOptions = {},
		private readonly registries: Registries = new Map()
	) {}

	walk(value: unknown, schema: NodeSchema, cursor: Cursor = { path: '$', depth: 0 }): void {
		if (cursor.depth === 0) this.root = value;
		if (cursor.depth > MAX_DEPTH) {
			this.diagnostics.push(unresolved('CFG_DEPTH', cursor.path, 'Maximum validation depth reached.'));
			return;
		}
		if (schema.handledBy !== undefined && this.reportUnhandled(schema.handledBy, cursor.path)) return;
		if (schema.kind === 'union') {
			this.walkUnion(value, selectVariant(value, schema, { registries: this.registries, root: this.root }), cursor);
			return;
		}
		if (schema.kind === 'any' || !this.matchesShape(value, schema, cursor.path)) return;
		if (isContainer(value)) this.walkContainer(value, schema, cursor);
	}

	private walkUnion(value: unknown, selection: Selection, cursor: Cursor): void {
		const { path } = cursor;
		switch (selection.kind) {
			case 'variant':
				this.walk(value, selection.schema, cursor);
				return;
			case 'accepted':
				return;
			case 'mismatch':
				this.diagnostics.push(confirmed('CFG_TYPE', path, `Expected ${selection.expected}, got ${kindOf(value)}.`));
				return;
			case 'ambiguous':
				this.diagnostics.push(
					inconclusive('CFG_AMBIGUOUS', path, 'Value fits several schema variants; its contents are not checked.')
				);
				return;
			case 'unknown-variant':
			case 'invalid-variant':
				this.reportVariant(selection, `${path}.${selection.key}`);
				return;
			case 'registered':
			case 'unregistered':
				this.reportRegistration(selection, path);
		}
	}

	/** An option for a component or plugin the runtime does not have: its contents do not matter. */
	private reportUnhandled(handler: Handler, path: string): boolean {
		if (isHandled(this.registries, handler) !== false) return false;
		const { name } = handler;
		this.diagnostics.push(
			handler.enforced
				? {
						...confirmed(
							'CFG_UNREGISTERED',
							path,
							`"${name}" is not registered with the runtime, which rejects this option.`
						),
						suggestion: `Register ${name}.`
					}
				: {
						code: 'CFG_INEFFECTIVE',
						severity: 'warning',
						confidence: 'certain',
						path,
						message: `"${name}" is not registered, so the runtime ignores this option.`,
						suggestion: `Register ${name}, or remove the option.`
					}
		);
		return true;
	}

	private reportRegistration(
		selection: Extract<Selection, { kind: 'registered' | 'unregistered' }>,
		path: string
	): void {
		const { key, value } = selection;
		if (selection.kind === 'registered') {
			const message = `"${value}" is registered by an extension; its options are not checked.`;
			this.diagnostics.push(inconclusive('CFG_REGISTERED_VARIANT', `${path}.${key}`, message));
			return;
		}
		const { name, siblings } = selection.registration;
		// The registry name, when it differs from the value (`dataZoom.slider` for `slider`).
		const as = name === value ? '' : ` (${name})`;
		const message = selection.defaulted
			? `No ${key} given: the runtime picks "${value}"${as}, which is not registered, so it rejects it.`
			: `"${value}" is not registered with the runtime${as}, which rejects it.`;
		const hint =
			siblings.length === 0
				? `Register ${name}.`
				: `Register ${name}, or use a registered one: ${siblings.join(', ')}.`;
		this.diagnostics.push({
			...confirmed('CFG_UNREGISTERED', selection.defaulted ? path : `${path}.${key}`, message),
			suggestion: hint
		});
	}

	private reportVariant(
		selection: Extract<Selection, { kind: 'unknown-variant' | 'invalid-variant' }>,
		path: string
	): void {
		const known = selection.known.map(String);
		if (selection.kind === 'invalid-variant') {
			this.diagnostics.push(confirmed('CFG_ENUM', path, `Value must be one of: ${known.join(', ')}.`));
			return;
		}
		const value = typeof selection.value === 'string' ? selection.value : kindOf(selection.value);
		const match = typeof selection.value === 'string' ? suggestion(selection.value, known) : undefined;
		this.diagnostics.push({
			...unresolved('CFG_UNKNOWN_VARIANT', path, `"${value}" is not a built-in variant; it may come from a plugin.`),
			...(match === undefined ? {} : { suggestion: `Did you mean "${match}"?` })
		});
	}

	private matchesShape(value: unknown, schema: NodeSchema, path: string): boolean {
		const actual = kindOf(value);
		if (actual !== schema.kind) {
			this.diagnostics.push(confirmed('CFG_TYPE', path, `Expected ${schema.kind}, got ${actual}.`));
			return false;
		}
		if (schema.enum !== undefined && !schema.enum.some((allowed) => allowed === value))
			this.diagnostics.push(confirmed('CFG_ENUM', path, `Value must be one of: ${schema.enum.join(', ')}.`));
		return true;
	}

	private walkContainer(container: object, schema: NodeSchema, cursor: Cursor): void {
		if (this.ancestors.has(container)) {
			this.diagnostics.push(
				unresolved('CFG_CYCLE', cursor.path, 'Cyclic configuration reference; cannot fully validate.')
			);
			return;
		}
		this.ancestors.add(container);
		try {
			if (isListLike(container)) this.walkArray(container, schema, cursor);
			else this.walkObject(container, schema, cursor);
		} finally {
			this.ancestors.delete(container);
		}
	}

	/** Consecutive holes are one finding (`$.a[3..9]`), so a sparse array cannot flood the report. */
	private walkArray(items: ArrayLike<unknown>, schema: NodeSchema, cursor: Cursor): void {
		if (items.length > MAX_ENTRIES)
			this.diagnostics.push(unresolved('CFG_TRUNCATED', cursor.path, 'Array inspection limit reached.'));
		const { element } = schema;
		if (element === undefined) return;
		const count = Math.min(items.length, MAX_ENTRIES);
		for (const run of holeRuns(items, count))
			this.diagnostics.push(
				unresolved('CFG_DYNAMIC', cursor.path + rangeSegment(run), 'Array entry is a hole or accessor; not evaluated.')
			);
		// An explicit `undefined` element means "not provided", exactly as an `undefined` property does.
		for (let index = 0; index < count; index++) {
			const entry = ownDataProperty(items, String(index));
			if (entry.found && entry.value !== undefined)
				this.walk(entry.value, element, descend(cursor, `[${String(index)}]`));
		}
	}

	private walkObject(object: object, schema: NodeSchema, cursor: Cursor): void {
		this.checkRequired(object, schema.required ?? [], cursor.path);
		const keys = Object.keys(object);
		if (keys.length > MAX_ENTRIES)
			this.diagnostics.push(unresolved('CFG_TRUNCATED', cursor.path, 'Object inspection limit reached.'));
		for (const key of keys.slice(0, MAX_ENTRIES)) this.walkProperty(object, key, schema, descend(cursor, `.${key}`));
	}

	/**
	 * An explicit `undefined` is absent, exactly as `walkProperty` treats it; an accessor counts as present.
	 * For an incomplete input (static extraction with unresolved spreads) a missing key is unresolved,
	 * because the part that was not extracted may supply it.
	 */
	private checkRequired(object: object, required: readonly string[], path: string): void {
		const report = this.options.incomplete === true ? unresolved : confirmed;
		for (const key of required) {
			const entry = ownDataProperty(object, key);
			const present = Object.hasOwn(object, key) && !(entry.found && entry.value === undefined);
			if (!present)
				this.diagnostics.push(report('CFG_REQUIRED', `${path}.${key}`, `Missing required property ${key}.`));
		}
	}

	private walkProperty(object: object, key: string, schema: NodeSchema, cursor: Cursor): void {
		const entry = ownDataProperty(object, key);
		if (!entry.found) {
			this.diagnostics.push(
				unresolved('CFG_DYNAMIC', cursor.path, 'Property is an accessor; getter intentionally not executed.')
			);
			return;
		}
		if (entry.value === undefined || this.isUnset(entry.value, key, schema)) return;
		const known = schema.properties ?? {};
		const field = Object.hasOwn(known, key) ? known[key] : schema.values;
		if (field === undefined) this.reportUnknownKey(key, Object.keys(known), schema, cursor.path);
		else this.walk(entry.value, field, cursor);
	}

	/** `null` on an optional property of an object whose runtime reads options with `pick()`. */
	private isUnset(value: unknown, key: string, schema: NodeSchema): boolean {
		return value === null && schema.nullAsAbsent === true && !(schema.required ?? []).includes(key);
	}

	private reportUnknownKey(key: string, knownKeys: readonly string[], schema: NodeSchema, path: string): void {
		if (schema.additionalProperties === 'allow') return;
		const { coverage } = this.manifest;
		const certain = schema.additionalProperties === 'deny' && coverage === 'full';
		const match = suggestion(key, knownKeys);
		this.diagnostics.push({
			code: 'CFG_UNKNOWN_KEY',
			severity: certain ? 'error' : 'warning',
			path,
			message: `Unknown property "${key}" for this ${coverage} schema.`,
			confidence: certain ? 'certain' : 'unknown',
			...(match === undefined ? {} : { suggestion: `Did you mean "${match}"?` })
		});
	}
}
