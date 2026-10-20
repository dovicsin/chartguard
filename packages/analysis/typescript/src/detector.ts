import ts from 'typescript';

import type { Origins } from './origins.js';
import { type ArgumentRule, ECHARTS_INIT, matches, type PropRule, type Rule } from './patterns.js';
import { bindingOf } from './scope.js';

export type Call = ts.CallExpression | ts.NewExpression;
export type Tag = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

/** A matched call: its rule and the expression holding the config. */
export interface CallMatch {
	readonly rule: Rule;
	readonly config: ts.Expression;
}

/** Recognizes calls and JSX tags of chart libraries by where their callee comes from; reads only. */
export class UseDetector {
	constructor(
		private readonly origins: Origins,
		private readonly rules: readonly Rule[],
		private readonly checker: ts.TypeChecker
	) {}

	matchCall(call: Call): CallMatch | undefined {
		const echarts = this.setOption(call);
		if (echarts !== undefined) return echarts;
		const origin = this.origins.of(call.expression);
		if (origin === undefined) return undefined;
		const construct = ts.isNewExpression(call);
		const rule = this.rules.find(
			(candidate) =>
				candidate.call !== undefined &&
				(candidate.call.construct === 'either' || candidate.call.construct === construct) &&
				matches(candidate, origin)
		);
		const config = rule?.call === undefined ? undefined : this.argument(rule.call.argument, call.arguments ?? []);
		return rule === undefined || config === undefined ? undefined : { rule, config };
	}

	matchTag(tag: Tag): { rule: Rule; jsx: PropRule } | undefined {
		const origin = this.origins.of(tag.tagName);
		const rule =
			origin === undefined
				? undefined
				: this.rules.find((candidate) => candidate.jsx !== undefined && matches(candidate, origin));
		return rule?.jsx === undefined ? undefined : { rule, jsx: rule.jsx };
	}

	/** `instance.setOption(option)` where the instance is `echarts.init(…)`, directly or as a `const`. */
	private setOption(call: Call): CallMatch | undefined {
		const callee = call.expression;
		const [option] = call.arguments ?? [];
		if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(callee) || callee.name.text !== 'setOption')
			return undefined;
		return option !== undefined && this.isEchartsInstance(callee.expression)
			? { rule: ECHARTS_INIT, config: option }
			: undefined;
	}

	private isEchartsInstance(node: ts.Expression): boolean {
		if (ts.isCallExpression(node)) {
			const origin = this.origins.of(node.expression);
			return origin !== undefined && matches(ECHARTS_INIT, origin);
		}
		if (!ts.isIdentifier(node)) return false;
		const declaration = this.checker.getSymbolAtLocation(node)?.valueDeclaration;
		// A `let` may hold another instance by the time it is called.
		return (
			declaration !== undefined &&
			ts.isVariableDeclaration(declaration) &&
			bindingOf(declaration) === 'const' &&
			declaration.initializer !== undefined &&
			ts.isCallExpression(declaration.initializer) &&
			this.isEchartsInstance(declaration.initializer)
		);
	}

	/** Highcharts `chart([renderTo,] options[, callback])`: options come second unless a callback does. */
	private argument(rule: ArgumentRule, args: readonly ts.Expression[]): ts.Expression | undefined {
		if (rule !== 'highcharts-options') return args[rule];
		const [first, second] = args;
		return second === undefined || this.isFunction(second) ? first : second;
	}

	private isFunction(node: ts.Expression): boolean {
		if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return true;
		const declaration = ts.isIdentifier(node) ? this.checker.getSymbolAtLocation(node)?.valueDeclaration : undefined;
		return declaration !== undefined && ts.isFunctionDeclaration(declaration);
	}
}
