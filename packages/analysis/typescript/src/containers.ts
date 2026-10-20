import { isRecord } from '@chartguard/core';
import ts from 'typescript';

import type { Decoded } from './decoded.js';
import { staticKey } from './literals.js';
import type { Trace, UnknownReason } from './trace.js';

export type Decode = (node: ts.Expression) => Decoded;

/** Defined rather than assigned so keys such as `__proto__` cannot reach the prototype. */
function defineEntry(target: Record<string, unknown>, key: string, value: unknown): void {
	Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

const freshRecord = (): Record<string, unknown> => Object.create(null) as Record<string, unknown>;

/** A spread has unknown length, so the whole array is unresolved; a single unknown element is a hole (A3). */
export function decodeArray(node: ts.ArrayLiteralExpression, decode: Decode): Decoded {
	if (node.elements.some(ts.isSpreadElement))
		return { value: undefined, complete: false, trace: { node, unknown: 'spread' } };
	const value: unknown[] = [];
	const entries = new Map<string, Trace>();
	let complete = true;
	node.elements.forEach((element, index) => {
		const item = decode(element);
		if (item.complete || item.value !== undefined) value.push(item.value);
		else value.length += 1;
		if (item.trace !== undefined) entries.set(String(index), item.trace);
		complete &&= item.complete;
	});
	return { value, complete, trace: { node, entries } };
}

/** An object literal being read: its known keys, their traces, and whether other keys may exist. */
class ObjectReader {
	private target = freshRecord();
	private entries = new Map<string, Trace>();
	private complete = true;
	private open: { node: ts.Node; reason: UnknownReason } | undefined;

	constructor(private readonly decode: Decode) {}

	add(property: ts.ObjectLiteralElementLike): void {
		if (ts.isSpreadAssignment(property)) this.spread(property);
		else if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) this.named(property);
		else this.unknownKeys(property, 'expression');
	}

	result(node: ts.ObjectLiteralExpression): Decoded {
		const open = this.open === undefined ? {} : { open: this.open };
		return { value: this.target, complete: this.complete, trace: { node, entries: this.entries, ...open } };
	}

	/** A method, an accessor or a computed key: some key may exist that this reader does not know. */
	private unknownKeys(property: ts.Node, reason: UnknownReason): void {
		this.complete = false;
		this.open = { node: property, reason };
	}

	private named(property: ts.PropertyAssignment | ts.ShorthandPropertyAssignment): void {
		const key = staticKey(property.name);
		if (key === undefined) {
			this.unknownKeys(property, 'computed-key');
			return;
		}
		const part = this.decode(ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer);
		if (part.complete || part.value !== undefined) defineEntry(this.target, key, part.value);
		if (part.trace !== undefined) this.entries.set(key, part.trace);
		this.complete &&= part.complete;
	}

	/**
	 * An unresolved spread may override every key written before it, so those keys are no longer
	 * known: the object starts over. Spreading `null`/`undefined` is a no-op; spreading an array or
	 * a string adds index keys this reader does not model, so the object stays incomplete.
	 */
	private spread(property: ts.SpreadAssignment): void {
		const part = this.decode(property.expression);
		if (!part.complete) this.restart(property);
		if (isRecord(part.value)) this.copy(part.value, part.trace);
		// Spreading `null`/`undefined` adds nothing; anything else that is not an object is not modelled.
		const nothing = part.value === null || part.value === undefined;
		this.complete &&= part.complete && (isRecord(part.value) || nothing);
	}

	private copy(record: Record<string, unknown>, trace: Trace | undefined): void {
		for (const [key, entry] of Object.entries(record)) {
			defineEntry(this.target, key, entry);
			const child = trace?.entries?.get(key);
			if (child !== undefined) this.entries.set(key, child);
		}
	}

	private restart(property: ts.SpreadAssignment): void {
		this.target = freshRecord();
		this.entries = new Map();
		this.open = { node: property, reason: 'spread' };
	}
}

export function decodeObject(node: ts.ObjectLiteralExpression, decode: Decode): Decoded {
	const reader = new ObjectReader(decode);
	for (const property of node.properties) reader.add(property);
	return reader.result(node);
}
