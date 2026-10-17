import { type Diagnostic, isContainer, ownDataProperty, suggestion } from '@chartguard/core';

import { confirmed, unresolved } from './diagnostics.js';
import type { NodeSchema, SchemaManifest } from './schema.js';

const MAX_DEPTH = 40;
const MAX_ENTRIES = 20_000;

interface Cursor {
	readonly path: string;
	readonly depth: number;
}

function descend(cursor: Cursor, segment: string): Cursor {
	return { path: `${cursor.path}${segment}`, depth: cursor.depth + 1 };
}

function kindOf(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	return typeof value;
}

/** Walks a config against a schema without invoking getters or recursing through cycles. */
export class ConfigWalker {
	readonly diagnostics: Diagnostic[] = [];
	private readonly ancestors = new WeakSet();

	constructor(private readonly manifest: SchemaManifest) {}

	walk(value: unknown, schema: NodeSchema, cursor: Cursor = { path: '$', depth: 0 }): void {
		if (cursor.depth > MAX_DEPTH) {
			this.diagnostics.push(unresolved('CFG_DEPTH', cursor.path, 'Maximum validation depth reached.'));
			return;
		}
		if (schema.kind === 'any' || !this.matchesShape(value, schema, cursor.path)) return;
		if (isContainer(value)) this.walkContainer(value, schema, cursor);
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
			if (Array.isArray(container)) this.walkArray(container, schema, cursor);
			else this.walkObject(container, schema, cursor);
		} finally {
			this.ancestors.delete(container);
		}
	}

	private walkArray(items: readonly unknown[], schema: NodeSchema, cursor: Cursor): void {
		if (items.length > MAX_ENTRIES)
			this.diagnostics.push(unresolved('CFG_TRUNCATED', cursor.path, 'Array inspection limit reached.'));
		const { element } = schema;
		if (element === undefined) return;
		const count = Math.min(items.length, MAX_ENTRIES);
		for (let index = 0; index < count; index++) {
			const child = descend(cursor, `[${String(index)}]`);
			const entry = ownDataProperty(items, String(index));
			if (entry.found) this.walk(entry.value, element, child);
			else
				this.diagnostics.push(
					unresolved('CFG_DYNAMIC', child.path, 'Array entry is a hole or accessor; not evaluated.')
				);
		}
	}

	private walkObject(object: object, schema: NodeSchema, cursor: Cursor): void {
		this.checkRequired(object, schema.required ?? [], cursor.path);
		const keys = Object.keys(object);
		if (keys.length > MAX_ENTRIES)
			this.diagnostics.push(unresolved('CFG_TRUNCATED', cursor.path, 'Object inspection limit reached.'));
		for (const key of keys.slice(0, MAX_ENTRIES)) this.walkProperty(object, key, schema, descend(cursor, `.${key}`));
	}

	private checkRequired(object: object, required: readonly string[], path: string): void {
		for (const key of required)
			if (!Object.hasOwn(object, key))
				this.diagnostics.push(confirmed('CFG_REQUIRED', `${path}.${key}`, `Missing required property ${key}.`));
	}

	private walkProperty(object: object, key: string, schema: NodeSchema, cursor: Cursor): void {
		const entry = ownDataProperty(object, key);
		if (!entry.found) {
			this.diagnostics.push(
				unresolved('CFG_DYNAMIC', cursor.path, 'Property is an accessor; getter intentionally not executed.')
			);
			return;
		}
		const known = schema.properties ?? {};
		const field = Object.hasOwn(known, key) ? known[key] : undefined;
		if (field === undefined) this.reportUnknownKey(key, Object.keys(known), schema, cursor.path);
		else this.walk(entry.value, field, cursor);
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
