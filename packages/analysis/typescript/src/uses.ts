import type { Diagnostic } from '@chartguard/core';
import ts from 'typescript';

import type { Bindings } from './bindings.js';
import { type Decoded, known } from './decoded.js';
import type { StaticDecoder } from './decoder.js';
import type { Call, Tag, UseDetector } from './detector.js';
import { chartjsConfig, type Prop, propsOf } from './jsx.js';
import { type Notes, type Position, positionAt } from './notes.js';
import type { ChartLibrary, PropRule, Rule } from './patterns.js';
import type { PathFact, Trace } from './trace.js';

/** A place where the analysed file hands a config to a chart library (CG-03-06). */
export interface ChartUse {
	readonly library: ChartLibrary;
	/** The pattern that matched (`chartjs.new-chart`, or a configured pattern's id). */
	readonly pattern: string;
	readonly line: number;
	readonly column: number;
	readonly value: unknown;
	readonly complete: boolean;
	/** Why the value is incomplete, if it is. */
	readonly diagnostics: readonly Diagnostic[];
	/** The binding passed, when the config is passed by name. */
	readonly source?: string;
	/** Where each path of the value comes from in source, or why it is unknown (CG-03-04). */
	readonly paths: readonly PathFact[];
}

/** A config read at a use, with the notes on why it is incomplete. */
interface Read {
	readonly value: unknown;
	readonly complete: boolean;
	readonly trace?: Trace | undefined;
	readonly diagnostics: readonly Diagnostic[];
	readonly source?: string;
}

/** Finds and reads every use in the analysed file. */
export class UseCollector {
	readonly uses: ChartUse[] = [];

	private readonly decoder: StaticDecoder;
	private readonly bindings: Bindings;
	private readonly notes: Notes;

	constructor(
		private readonly detector: UseDetector,
		reader: { readonly decoder: StaticDecoder; readonly bindings: Bindings; readonly notes: Notes },
		private readonly parses: boolean
	) {
		({ decoder: this.decoder, bindings: this.bindings, notes: this.notes } = reader);
	}

	visit(node: ts.Node): void {
		if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
			const match = this.detector.matchCall(node);
			if (match !== undefined) this.add(node, match.rule, match.config);
		} else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
			const match = this.detector.matchTag(node);
			if (match !== undefined) this.addTag(node, match.rule, match.jsx);
		}
	}

	private addTag(tag: Tag, rule: Rule, jsx: PropRule): void {
		const tagged = propsOf(tag);
		if ('chartType' in jsx) {
			const { value, complete, trace } = chartjsConfig(tagged, jsx.chartType, (prop) => this.readValue(prop), tag);
			this.push(tag, rule, { value, complete, trace, diagnostics: complete ? [] : [this.dynamic(tag)] });
			return;
		}
		const value = tagged.props.get(jsx.prop);
		const read =
			value === true || value === undefined
				? { value, complete: true, trace: { node: tag }, diagnostics: [] }
				: this.read(value, tag);
		// A spread attribute may supply the prop.
		this.push(
			tag,
			rule,
			tagged.spread ? { ...read, complete: false, diagnostics: [...read.diagnostics, this.dynamic(tag)] } : read
		);
	}

	private readValue(value: Prop): Decoded {
		return value === true ? known(true) : this.decoder.decode(value);
	}

	/**
	 * The config at `expression` with the notes on why it is incomplete. A binding passed by name
	 * names its writes (`CFG_MUTATED`); what is unresolved apart from them is `CFG_DYNAMIC`.
	 */
	private read(expression: ts.Expression, at: Call | Tag): Read {
		const { value, complete, trace } = this.decoder.decode(expression);
		if (!ts.isIdentifier(expression))
			return { value, complete, trace, diagnostics: complete ? [] : [this.dynamic(at)] };
		const target = this.bindings.ofIdentifier(expression);
		const passed = target?.kind === 'value' ? target : undefined;
		const writes = passed === undefined ? [] : this.bindings.writesTo(passed.declaration);
		const initial = passed === undefined ? complete : this.decoder.decode(passed.expression).complete;
		const diagnostics = [
			...writes.map((write) => this.notes.mutated(expression.text, write)),
			...(initial ? [] : [this.dynamic(at)])
		];
		return { value, complete, trace, diagnostics, source: expression.text };
	}

	private dynamic(at: Call | Tag): Diagnostic {
		return this.notes.note(
			'CFG_DYNAMIC',
			'The config cannot be completely resolved without executing code.',
			'$',
			this.position(at)
		);
	}

	private position(node: Call | Tag): Position {
		const file = node.getSourceFile();
		return positionAt(file, node.getStart(file));
	}

	private add(node: Call, rule: Rule, config: ts.Expression): void {
		this.push(node, rule, this.read(config, node));
	}

	private push(node: Call | Tag, rule: Rule, read: Read): void {
		const position = this.position(node);
		const syntax = this.parses
			? []
			: [this.notes.note('CFG_SYNTAX', 'Read from a file with syntax errors.', '$', position)];
		const { value, complete, diagnostics, source, trace } = read;
		this.uses.push({
			paths: this.notes.factsOf({ value, complete, ...(trace === undefined ? {} : { trace }) }),
			library: rule.library,
			pattern: rule.id,
			...position,
			value,
			complete: complete && this.parses,
			diagnostics: [...syntax, ...diagnostics],
			...(source === undefined ? {} : { source })
		});
	}
}
