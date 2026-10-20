import { isRecord } from '@chartguard/core';
import ts from 'typescript';

import type { Bindings, Target } from './bindings.js';
import type { Builder } from './builders.js';
import { agreement, logical, strictEquality, truthiness } from './choices.js';
import { type Decoded, known, UNRESOLVED } from './decoded.js';
import { decodeLiteral, isTransparentWrapper, staticKey } from './literals.js';
import { withoutWritten } from './writes.js';

const MAX_DEPTH = 25;

/** A builder being read (CG-03-05): its parameters' values, inside the frame it was called from. */
interface Frame {
	readonly builder: Builder;
	readonly values: ReadonlyMap<ts.Node, Decoded>;
	readonly parent: Frame | undefined;
}

interface Scope {
	readonly depth: number;
	/** Constants and builders being decoded on the way here: reaching one again is a cycle. */
	readonly seen: ReadonlySet<ts.Node>;
	readonly frame?: Frame | undefined;
}

const ROOT_SCOPE: Scope = { depth: 0, seen: new Set() };

function deeper(scope: Scope): Scope {
	return { ...scope, depth: scope.depth + 1 };
}

function within(scope: Scope, declaration: ts.Node, frame: Frame | undefined): Scope {
	return { depth: scope.depth + 1, seen: new Set([...scope.seen, declaration]), frame };
}

/** The frame, from `frame` outward, that binds `declaration` as a parameter or a local constant. */
function frameOf(frame: Frame | undefined, declaration: ts.Node): Frame | undefined {
	for (let current = frame; current !== undefined; current = current.parent)
		if (current.values.has(declaration) || current.builder.locals.has(declaration)) return current;
	return undefined;
}

const LOGICAL: ReadonlyMap<ts.SyntaxKind, '??' | '||' | '&&'> = new Map([
	[ts.SyntaxKind.QuestionQuestionToken, '??'],
	[ts.SyntaxKind.BarBarToken, '||'],
	[ts.SyntaxKind.AmpersandAmpersandToken, '&&']
]);

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
		if (ts.isIdentifier(node)) return this.decodeIdentifier(node, scope);
		if (ts.isPropertyAccessExpression(node)) return this.decodeTarget(this.bindings.ofMember(node), scope);
		if (ts.isArrayLiteralExpression(node)) return this.decodeArray(node, deeper(scope));
		if (ts.isObjectLiteralExpression(node)) return this.decodeObject(node, deeper(scope));
		return this.decodeComputed(node, deeper(scope));
	}

	/** Choices, comparisons and builder calls, decided without running anything (CG-03-05). */
	private decodeComputed(node: ts.Expression, scope: Scope): Decoded {
		if (ts.isConditionalExpression(node)) {
			const truthy = truthiness(this.decode(node.condition, scope));
			if (truthy !== undefined) return this.decode(truthy ? node.whenTrue : node.whenFalse, scope);
			return agreement(this.decode(node.whenTrue, scope), this.decode(node.whenFalse, scope));
		}
		if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
			const truthy = truthiness(this.decode(node.operand, scope));
			return truthy === undefined ? UNRESOLVED : known(!truthy);
		}
		if (ts.isBinaryExpression(node)) return this.decodeBinary(node, scope);
		return ts.isCallExpression(node) ? this.decodeCall(node, scope) : UNRESOLVED;
	}

	private decodeBinary(node: ts.BinaryExpression, scope: Scope): Decoded {
		const kind = node.operatorToken.kind;
		if (kind === ts.SyntaxKind.EqualsEqualsEqualsToken || kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
			const negated = kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
			return strictEquality(this.decode(node.left, scope), this.decode(node.right, scope), negated);
		}
		const operator = LOGICAL.get(kind);
		if (operator === undefined) return UNRESOLVED;
		const left = this.decode(node.left, scope);
		const right = (): Decoded => this.decode(node.right, scope);
		return logical(operator, left, right) ?? agreement(left, right());
	}

	/**
	 * A builder's result, read in a frame of its parameters: each is its argument, or its default
	 * (decoded in the frame, so it may read earlier parameters) when the argument is absent or `undefined`.
	 */
	private decodeCall(node: ts.CallExpression, scope: Scope): Decoded {
		const builder = this.bindings.builderAt(node.expression);
		if (builder === undefined || node.arguments.some(ts.isSpreadElement) || scope.seen.has(builder.declaration))
			return UNRESOLVED;
		const values = new Map<ts.Node, Decoded>();
		const frame: Frame = { builder, values, parent: scope.frame };
		const inner = within(scope, builder.declaration, frame);
		builder.parameters.forEach((parameter, index) => {
			const argument = node.arguments[index];
			const given = argument === undefined ? known(undefined) : this.decode(argument, scope);
			const { initializer } = parameter;
			const defaulted = given.complete && given.value === undefined && initializer !== undefined;
			values.set(parameter, defaulted ? this.decode(initializer, inner) : given);
		});
		return this.decode(builder.result, inner);
	}

	/** A parameter or local constant of a builder being read, else whatever the name is bound to. */
	private decodeIdentifier(node: ts.Identifier, scope: Scope): Decoded {
		const declaration = this.bindings.declarationAt(node);
		const frame = declaration === undefined ? undefined : frameOf(scope.frame, declaration);
		if (declaration === undefined || frame === undefined)
			return this.decodeTarget(this.bindings.ofIdentifier(node), scope);
		const value = frame.values.get(declaration);
		if (value !== undefined) return value;
		if (scope.seen.has(declaration) || !ts.isVariableDeclaration(declaration) || declaration.initializer === undefined)
			return UNRESOLVED;
		const decoded = this.decode(declaration.initializer, within(scope, declaration, frame));
		return withoutWritten(decoded, this.bindings.writesTo(declaration));
	}

	/** The value a name or namespace member is bound to (`Bindings`); a cycle between constants is unresolved. */
	private decodeTarget(target: Target | undefined, scope: Scope): Decoded {
		if (target === undefined) return UNRESOLVED;
		if (target.kind === 'undefined') return known(undefined);
		if (scope.seen.has(target.declaration)) return UNRESOLVED;
		// A top-level constant or an export reads no builder's parameters.
		const decoded = this.decode(target.expression, within(scope, target.declaration, undefined));
		return withoutWritten(decoded, this.bindings.writesTo(target.declaration));
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
