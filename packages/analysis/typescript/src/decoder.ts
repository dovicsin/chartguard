import ts from 'typescript';

import type { Bindings, Target } from './bindings.js';
import type { Builder } from './builders.js';
import { agreement, logical, strictEquality, truthiness } from './choices.js';
import { decodeArray, decodeObject } from './containers.js';
import { type Decoded, known, UNRESOLVED } from './decoded.js';
import { decodeLiteral, isTransparentWrapper } from './literals.js';
import { reasonOf, type UnknownReason } from './trace.js';
import { withoutWritten } from './writes.js';

const MAX_DEPTH = 25;
/**
 * References one file's reading follows at most (CG-03-08): a name or a builder call may read the
 * same constant many times (`const a2 = x ? a1 : a1` doubles per level), so following is bounded in
 * total. Literals are read regardless: their reading is linear in the size of the source.
 */
export const MAX_DECODE_STEPS = 100_000;

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

const unknownAt = (node: ts.Node, reason: UnknownReason): Decoded => ({
	...UNRESOLVED,
	trace: { node, unknown: reason }
});

const LOGICAL: ReadonlyMap<ts.SyntaxKind, '??' | '||' | '&&'> = new Map([
	[ts.SyntaxKind.QuestionQuestionToken, '??'],
	[ts.SyntaxKind.BarBarToken, '||'],
	[ts.SyntaxKind.AmpersandAmpersandToken, '&&']
]);

/**
 * Bounded static reader for expressions. Never evaluates code.
 *
 * Partial results keep what is known and leave an explicit gap for the rest:
 * an unresolved array element is a hole, an unresolved property is omitted and a
 * partially known container is kept, so nothing unknown ever turns into a value.
 * Every result carries its trace: where each part comes from, or why it is unknown (CG-03-04).
 */
export class StaticDecoder {
	private steps = 0;

	constructor(private readonly bindings: Bindings) {}

	/** Whether the work bound was reached: some value of this file was left unknown for it. */
	get exhausted(): boolean {
		return this.steps > MAX_DECODE_STEPS;
	}

	/** Counts one reference followed; false once the bound is passed. */
	private follow(): boolean {
		this.steps += 1;
		return !this.exhausted;
	}

	decode(node: ts.Expression, scope: Scope = ROOT_SCOPE): Decoded {
		if (scope.depth > MAX_DEPTH) return unknownAt(node, 'limit');
		const decoded = this.decodeNode(node, scope);
		if (decoded.trace !== undefined) return decoded;
		return { ...decoded, trace: decoded.complete ? { node } : { node, unknown: reasonOf(node) } };
	}

	private decodeNode(node: ts.Expression, scope: Scope): Decoded {
		if (isTransparentWrapper(node)) return this.decode(node.expression, deeper(scope));
		const literal = decodeLiteral(node);
		if (literal !== undefined) return literal;
		if (ts.isIdentifier(node)) return this.decodeIdentifier(node, scope);
		if (ts.isPropertyAccessExpression(node)) return this.decodeTarget(this.bindings.ofMember(node), node, scope);
		const inner = deeper(scope);
		if (ts.isArrayLiteralExpression(node)) return decodeArray(node, (element) => this.decode(element, inner));
		if (ts.isObjectLiteralExpression(node)) return decodeObject(node, (value) => this.decode(value, inner));
		return this.decodeComputed(node, inner);
	}

	/** Choices, comparisons and builder calls, decided without running anything (CG-03-05). */
	private decodeComputed(node: ts.Expression, scope: Scope): Decoded {
		if (ts.isConditionalExpression(node)) {
			const truthy = truthiness(this.decode(node.condition, scope));
			if (truthy !== undefined) return this.decode(truthy ? node.whenTrue : node.whenFalse, scope);
			return agreement(this.decode(node.whenTrue, scope), this.decode(node.whenFalse, scope), node);
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
		return logical(operator, left, right) ?? agreement(left, right(), node);
	}

	/**
	 * A builder's result, read in a frame of its parameters: each is its argument, or its default
	 * (decoded in the frame, so it may read earlier parameters) when the argument is absent or `undefined`.
	 */
	private decodeCall(node: ts.CallExpression, scope: Scope): Decoded {
		if (!this.follow()) return unknownAt(node, 'limit');
		const builder = this.bindings.builderAt(node.expression);
		if (builder === undefined || node.arguments.some(ts.isSpreadElement)) return UNRESOLVED;
		if (scope.seen.has(builder.declaration)) return unknownAt(node, 'cycle');
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
		if (!this.follow()) return unknownAt(node, 'limit');
		const declaration = this.bindings.declarationAt(node);
		const frame = declaration === undefined ? undefined : frameOf(scope.frame, declaration);
		if (declaration === undefined || frame === undefined)
			return this.decodeTarget(this.bindings.ofIdentifier(node), node, scope);
		const value = frame.values.get(declaration);
		if (value !== undefined) return value;
		if (scope.seen.has(declaration)) return unknownAt(node, 'cycle');
		if (!ts.isVariableDeclaration(declaration) || declaration.initializer === undefined) return UNRESOLVED;
		const decoded = this.decode(declaration.initializer, within(scope, declaration, frame));
		return withoutWritten(decoded, this.bindings.writesTo(declaration));
	}

	/** The value a name or namespace member is bound to (`Bindings`); a cycle between constants is unresolved. */
	private decodeTarget(target: Target | undefined, node: ts.Expression, scope: Scope): Decoded {
		if (!this.follow()) return unknownAt(node, 'limit');
		if (target === undefined) return UNRESOLVED;
		if (target.kind === 'undefined') return known(undefined);
		if (scope.seen.has(target.declaration)) return unknownAt(node, 'cycle');
		// A top-level constant or an export reads no builder's parameters.
		const decoded = this.decode(target.expression, within(scope, target.declaration, undefined));
		return withoutWritten(decoded, this.bindings.writesTo(target.declaration));
	}
}
