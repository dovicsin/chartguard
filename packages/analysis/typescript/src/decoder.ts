import { isRecord } from '@chartguard/core';
import ts from 'typescript';

import type { Bindings, Target } from './bindings.js';
import { type Decoded, known, UNRESOLVED } from './decoded.js';
import { decodeLiteral, isTransparentWrapper, staticKey } from './literals.js';

const MAX_DEPTH = 25;

interface Scope {
	readonly depth: number;
	/** Constants being decoded on the way here: reaching one again is a cycle. */
	readonly seen: ReadonlySet<ts.Node>;
}

const ROOT_SCOPE: Scope = { depth: 0, seen: new Set() };

function deeper(scope: Scope): Scope {
	return { depth: scope.depth + 1, seen: scope.seen };
}

/** Defined rather than assigned so keys such as `__proto__` cannot reach the prototype. */
function defineEntry(target: Record<string, unknown>, key: string, value: unknown): void {
	Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

interface Merged {
	readonly target: Record<string, unknown>;
	readonly complete: boolean;
}

const freshRecord = (): Record<string, unknown> => Object.create(null) as Record<string, unknown>;

/**
 * Bounded static reader for literal expressions. Never evaluates code.
 *
 * Partial results keep what is known and leave an explicit gap for the rest:
 * an unresolved array element is a hole, an unresolved property is omitted and a
 * partially known container is kept, so nothing unknown ever turns into a value.
 */
export class StaticDecoder {
	constructor(private readonly bindings: Bindings) {}

	decode(node: ts.Expression, scope: Scope = ROOT_SCOPE): Decoded {
		if (scope.depth > MAX_DEPTH) return UNRESOLVED;
		if (isTransparentWrapper(node)) return this.decode(node.expression, deeper(scope));
		const literal = decodeLiteral(node);
		if (literal !== undefined) return literal;
		if (ts.isIdentifier(node)) return this.decodeTarget(this.bindings.ofIdentifier(node), scope);
		if (ts.isPropertyAccessExpression(node)) return this.decodeTarget(this.bindings.ofMember(node), scope);
		if (ts.isArrayLiteralExpression(node)) return this.decodeArray(node, deeper(scope));
		if (ts.isObjectLiteralExpression(node)) return this.decodeObject(node, deeper(scope));
		return UNRESOLVED;
	}

	/** The value a name or namespace member is bound to (`Bindings`); a cycle between constants is unresolved. */
	private decodeTarget(target: Target | undefined, scope: Scope): Decoded {
		if (target === undefined) return UNRESOLVED;
		if (target.kind === 'undefined') return known(undefined);
		if (scope.seen.has(target.declaration)) return UNRESOLVED;
		return this.decode(target.expression, {
			depth: scope.depth + 1,
			seen: new Set([...scope.seen, target.declaration])
		});
	}

	/** A spread has unknown length, so the whole array is unresolved; a single unknown element is a hole. */
	private decodeArray(node: ts.ArrayLiteralExpression, scope: Scope): Decoded {
		if (node.elements.some(ts.isSpreadElement)) return UNRESOLVED;
		const value: unknown[] = [];
		let complete = true;
		for (const element of node.elements) {
			const item = this.decode(element, scope);
			if (item.complete || item.value !== undefined) value.push(item.value);
			else value.length += 1;
			complete &&= item.complete;
		}
		return { value, complete };
	}

	private decodeObject(node: ts.ObjectLiteralExpression, scope: Scope): Decoded {
		let merged: Merged = { target: freshRecord(), complete: true };
		for (const property of node.properties) {
			const step = this.decodeProperty(property, merged.target, scope);
			merged = { target: step.target, complete: merged.complete && step.complete };
		}
		return { value: merged.target, complete: merged.complete };
	}

	/** Adds one property to `target`; a spread may hand back a fresh target when earlier keys stop being known. */
	private decodeProperty(property: ts.ObjectLiteralElementLike, target: Record<string, unknown>, scope: Scope): Merged {
		if (ts.isSpreadAssignment(property)) return this.mergeSpread(property, target, scope);
		if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property))
			return { target, complete: false };
		const key = staticKey(property.name);
		if (key === undefined) return { target, complete: false };
		const initializer = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer;
		const part = this.decode(initializer, scope);
		if (part.complete || part.value !== undefined) defineEntry(target, key, part.value);
		return { target, complete: part.complete };
	}

	/**
	 * An unresolved spread may override every key written before it, so those keys are no longer
	 * known: the object starts over. Spreading `null`/`undefined` is a no-op; spreading an array or
	 * a string adds index keys this reader does not model, so the object stays incomplete.
	 */
	private mergeSpread(property: ts.SpreadAssignment, previous: Record<string, unknown>, scope: Scope): Merged {
		const part = this.decode(property.expression, scope);
		const target = part.complete ? previous : freshRecord();
		if (isRecord(part.value)) {
			for (const [key, entry] of Object.entries(part.value)) defineEntry(target, key, entry);
			return { target, complete: part.complete };
		}
		return { target, complete: part.complete && (part.value === null || part.value === undefined) };
	}
}
