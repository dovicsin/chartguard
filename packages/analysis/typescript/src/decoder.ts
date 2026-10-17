import { isRecord } from '@chartguard/core';
import ts from 'typescript';

import { type Decoded, UNRESOLVED } from './decoded.js';
import { decodeLiteral, isTransparentWrapper, staticKey } from './literals.js';

const MAX_DEPTH = 25;

interface Scope {
	readonly depth: number;
	readonly seen: ReadonlySet<string>;
}

const ROOT_SCOPE: Scope = { depth: 0, seen: new Set() };

function deeper(scope: Scope): Scope {
	return { depth: scope.depth + 1, seen: scope.seen };
}

/** Defined rather than assigned so keys such as `__proto__` cannot reach the prototype. */
function defineEntry(target: Record<string, unknown>, key: string, value: unknown): void {
	Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/** Bounded static reader for literal expressions. Never evaluates code. */
export class StaticDecoder {
	constructor(private readonly symbols: ReadonlyMap<string, ts.Expression>) {}

	decode(node: ts.Expression, scope: Scope = ROOT_SCOPE): Decoded {
		if (scope.depth > MAX_DEPTH) return UNRESOLVED;
		if (isTransparentWrapper(node)) return this.decode(node.expression, deeper(scope));
		const literal = decodeLiteral(node);
		if (literal !== undefined) return literal;
		if (ts.isIdentifier(node)) return this.decodeIdentifier(node, scope);
		if (ts.isArrayLiteralExpression(node)) return this.decodeArray(node, deeper(scope));
		if (ts.isObjectLiteralExpression(node)) return this.decodeObject(node, deeper(scope));
		return UNRESOLVED;
	}

	private decodeIdentifier(node: ts.Identifier, scope: Scope): Decoded {
		const initializer = this.symbols.get(node.text);
		if (initializer === undefined || scope.seen.has(node.text)) return UNRESOLVED;
		return this.decode(initializer, { depth: scope.depth + 1, seen: new Set([...scope.seen, node.text]) });
	}

	private decodeArray(node: ts.ArrayLiteralExpression, scope: Scope): Decoded {
		const value: unknown[] = [];
		let complete = true;
		for (const element of node.elements) {
			if (ts.isSpreadElement(element)) {
				complete = false;
				continue;
			}
			const item = this.decode(element, scope);
			value.push(item.value);
			complete &&= item.complete;
		}
		return { value, complete };
	}

	private decodeObject(node: ts.ObjectLiteralExpression, scope: Scope): Decoded {
		const value = Object.create(null) as Record<string, unknown>;
		let complete = true;
		for (const property of node.properties) complete = this.decodeProperty(property, value, scope) && complete;
		return { value, complete };
	}

	/** Returns whether the property was resolved completely. */
	private decodeProperty(
		property: ts.ObjectLiteralElementLike,
		target: Record<string, unknown>,
		scope: Scope
	): boolean {
		if (ts.isSpreadAssignment(property)) return this.mergeSpread(property, target, scope);
		if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return false;
		const key = staticKey(property.name);
		if (key === undefined) return false;
		const initializer = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer;
		const part = this.decode(initializer, scope);
		if (part.complete) defineEntry(target, key, part.value);
		return part.complete;
	}

	private mergeSpread(property: ts.SpreadAssignment, target: Record<string, unknown>, scope: Scope): boolean {
		const part = this.decode(property.expression, scope);
		if (isRecord(part.value)) for (const [key, entry] of Object.entries(part.value)) defineEntry(target, key, entry);
		return part.complete;
	}
}
