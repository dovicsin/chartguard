import { isRecord } from '@chartguard/core';
import ts from 'typescript';

import { type Decoded, known, UNRESOLVED } from './decoded.js';
import { decodeLiteral, isTransparentWrapper, staticKey } from './literals.js';
import { bindingOf, isDynamicScope } from './scope.js';

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
	constructor(
		private readonly checker: ts.TypeChecker,
		private readonly file: ts.SourceFile
	) {}

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

	/**
	 * A name resolves through the checker to what it is bound to, exactly as the runtime scopes it,
	 * unless the scope is dynamic (`with`, direct `eval`). Only a top-level `const` of this file has
	 * a value (A1); a parameter, a local, a `let`, an import (CG-03-03) is unresolved.
	 */
	private decodeIdentifier(node: ts.Identifier, scope: Scope): Decoded {
		if (isDynamicScope(node)) return UNRESOLVED;
		const symbol = this.symbolOf(node);
		// The checker's own `undefined`: no declaration anywhere, so nothing shadows it.
		if (symbol?.name === 'undefined' && (symbol.declarations ?? []).length === 0) return known(undefined);
		// A value and a type may share a name (`const config` and `interface config`): the value is what is read.
		const declaration = symbol?.valueDeclaration;
		if (declaration === undefined || !this.isTopLevelConstant(declaration) || scope.seen.has(declaration))
			return UNRESOLVED;
		return this.decode(declaration.initializer, {
			depth: scope.depth + 1,
			seen: new Set([...scope.seen, declaration])
		});
	}

	/** `{ min }` names the property; the value it reads is the binding `min`. */
	private symbolOf(node: ts.Identifier): ts.Symbol | undefined {
		const { parent } = node;
		if (ts.isShorthandPropertyAssignment(parent) && parent.name === node)
			return this.checker.getShorthandAssignmentValueSymbol(parent);
		return this.checker.getSymbolAtLocation(node);
	}

	private isTopLevelConstant(node: ts.Node): node is ts.VariableDeclaration & { readonly initializer: ts.Expression } {
		return (
			ts.isVariableDeclaration(node) &&
			node.initializer !== undefined &&
			bindingOf(node) === 'const' &&
			ts.isVariableStatement(node.parent.parent) &&
			node.parent.parent.parent === this.file
		);
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
