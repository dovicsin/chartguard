import type { ESLint, Linter, Rule } from 'eslint';

import { analysisOf, type Finding } from './analysis.js';

/**
 * ESLint 9 flat-config plugin (CG-06-03 part 1): the chart configs a file hands to Chart.js,
 * ECharts or Highcharts, read without running anything and validated, each finding at the range
 * that wrote its value. `valid-config` reports errors, `config-warnings` warnings; info findings are
 * no claim. No fixes yet.
 */
export const meta = { name: '@chartguard/eslint-plugin', version: '0.1.0' };

/** A rule reporting the findings of one severity; both share one analysis per file. */
function findingsRule(severity: Finding['severity'], description: string): Rule.RuleModule {
	return {
		meta: { type: 'problem', docs: { description }, schema: [], messages: { finding: '{{text}}' } },
		create(context) {
			const { sourceCode } = context;
			// Another language (JSON, CSS) has no ESTree Program: nothing here reads it.
			if ((sourceCode.ast as { type?: unknown }).type !== 'Program') return {};
			return {
				Program() {
					for (const finding of analysisOf(sourceCode, context.settings, context.filename))
						if (finding.severity === severity)
							context.report({ loc: finding.loc, messageId: 'finding', data: { text: finding.message } });
				}
			};
		}
	};
}

export const rules = {
	'valid-config': findingsRule(
		'error',
		'Chart configs handed to Chart.js, ECharts or Highcharts hold no value the runtime rejects or misreads.'
	),
	'config-warnings': findingsRule(
		'warning',
		'Chart configs carry no unknown key, deprecated option or value without effect.'
	)
};

interface Plugin extends ESLint.Plugin {
	readonly meta: typeof meta;
	readonly rules: typeof rules;
	readonly configs: { readonly recommended: Linter.Config };
}

const recommended: Linter.Config = {
	name: 'chartguard/recommended',
	rules: { 'chartguard/valid-config': 'error', 'chartguard/config-warnings': 'warn' }
};

const plugin: Plugin = { meta, rules, configs: { recommended } };
// A flat config registers the plugin it names itself.
recommended.plugins = { chartguard: plugin };

export default plugin;
