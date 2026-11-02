import type { FindingKind, TextEdit } from '@chartguard/source-checks';
import type { ESLint, Linter, Rule } from 'eslint';

import { analysisOf } from './analysis.js';

/**
 * ESLint 9 flat-config plugin (CG-06-03), over `@chartguard/source-checks`: the chart configs a file
 * hands to Chart.js, ECharts or Highcharts, read without running anything, each finding at the range
 * that wrote its value.
 * `valid-config` reports the validator's errors, `config-warnings` its warnings (with the runtime's
 * own renames as fixes), `chart-quality` the advisory quality warnings (with their verified edits as
 * suggestions, never applied without the user). Info findings are no claim.
 */
export const meta = { name: '@chartguard/eslint-plugin', version: '0.1.0' };

/** ESLint's fixer for an edit: the checked text is ESLint's, so its offsets are ESLint's. */
const fixer =
	({ start, end, text }: TextEdit): Rule.ReportFixer =>
	(rule) =>
		rule.replaceTextRange([start, end], text);

/** What a rule declares beyond its description: the edits it may offer. */
type Offers = Pick<Rule.RuleMetaData, 'fixable' | 'hasSuggestions'>;

/** A rule reporting its own findings; the rules share one analysis per file. */
function findingsRule(rule: FindingKind, description: string, offers: Offers = {}): Rule.RuleModule {
	return {
		meta: {
			type: rule === 'chart-quality' ? 'suggestion' : 'problem',
			docs: { description },
			schema: [],
			messages: { finding: '{{text}}', edit: '{{text}}' },
			...offers
		},
		create(context) {
			const { sourceCode } = context;
			// Another language (JSON, CSS) has no ESTree Program: nothing here reads it.
			if ((sourceCode.ast as { type?: unknown }).type !== 'Program') return {};
			return {
				Program() {
					for (const finding of analysisOf(sourceCode, context.settings, context.filename, context.cwd)) {
						if (finding.kind !== rule) continue;
						const { fix, suggestion } = finding;
						const loc = {
							start: sourceCode.getLocFromIndex(finding.start),
							end: sourceCode.getLocFromIndex(finding.end)
						};
						context.report({
							loc,
							messageId: 'finding',
							data: { text: finding.message },
							...(fix === undefined ? {} : { fix: fixer(fix) }),
							...(suggestion === undefined
								? {}
								: {
										suggest: [
											{ messageId: 'edit', data: { text: suggestion.description }, fix: fixer(suggestion.edit) }
										]
									})
						});
					}
				}
			};
		}
	};
}

export const rules = {
	'valid-config': findingsRule(
		'valid-config',
		'Chart configs handed to Chart.js, ECharts or Highcharts hold no value the runtime rejects or misreads.'
	),
	'config-warnings': findingsRule(
		'config-warnings',
		'Chart configs carry no unknown key, deprecated option or value without effect.',
		{ fixable: 'code' }
	),
	'chart-quality': findingsRule(
		'chart-quality',
		'Chart configs avoid what misleads or excludes readers (advisory: depends on context).',
		{ hasSuggestions: true }
	)
};

interface Plugin extends ESLint.Plugin {
	readonly meta: typeof meta;
	readonly rules: typeof rules;
	readonly configs: { readonly recommended: Linter.Config };
}

const recommended: Linter.Config = {
	name: 'chartguard/recommended',
	rules: {
		'chartguard/valid-config': 'error',
		'chartguard/config-warnings': 'warn',
		'chartguard/chart-quality': 'warn'
	}
};

const plugin: Plugin = { meta, rules, configs: { recommended } };
// A flat config registers the plugin it names itself.
recommended.plugins = { chartguard: plugin };

export default plugin;
