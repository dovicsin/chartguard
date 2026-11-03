import type { Engine, FindingKind, SourceFinding, TextCheck } from '@chartguard/source-checks/text';

import type { Offer } from './edits.js';
import { type Example, formatJson } from './examples.js';
import type { LibraryId } from './libraries.js';
import type { Adapter } from './model.js';
import { type Item, renameOffer, type Shown } from './shown.js';

/** The language of the editor in source mode: it picks the file name the analysis reads the text as. */
export type Language = 'javascript' | 'typescript';

export const fileNameOf = (language: Language): string => (language === 'typescript' ? 'chart.ts' : 'chart.js');

/**
 * An example written as an application hands it to its library: the config literal in the call the
 * analysis recognises by where its callee comes from (CG-03-06). JSON is a JavaScript expression.
 */
const TEMPLATES: Readonly<Record<LibraryId, (config: string) => string>> = {
	chartjs: (config) =>
		`import { Chart } from 'chart.js';\n\nconst canvas = document.querySelector('canvas');\nnew Chart(canvas, ${config});\n`,
	echarts: (config) =>
		`import * as echarts from 'echarts';\n\nconst chart = echarts.init(document.getElementById('chart'));\nchart.setOption(${config});\n`,
	highcharts: (config) => `import Highcharts from 'highcharts';\n\nHighcharts.chart('container', ${config});\n`
};

export const sourceOf = (example: Example): string => TEMPLATES[example.library](formatJson(example.config));

/** The editors' engine over the playground's adapters: the shipped schemas, no settings. */
export const engineOf = (adapters: Readonly<Record<LibraryId, Adapter>>): Engine => ({
	validate: (library, config, options) => adapters[library].validate(config, options),
	review: (library, config) => adapters[library].analyze(config)
});

const SEVERITY: Readonly<Record<FindingKind, Item['severity']>> = {
	'valid-config': 'error',
	'config-warnings': 'warning',
	'chart-quality': 'warning'
};

function offerOfFinding({ fix, suggestion }: SourceFinding): Offer | undefined {
	if (fix !== undefined) return renameOffer(fix);
	return suggestion === undefined
		? undefined
		: { label: 'Change the chart', note: suggestion.description, edit: suggestion.edit };
}

/** The message without the `CODE path: ` the editors put in front of it: the list shows both apart. */
const messageOf = ({ code, path, message }: SourceFinding): string => message.replace(`${code} ${path}: `, '');

function itemOf(finding: SourceFinding): Item {
	const offer = offerOfFinding(finding);
	return {
		severity: SEVERITY[finding.kind],
		code: finding.code,
		path: finding.path,
		message: messageOf(finding),
		range: { start: finding.start, end: finding.end },
		...(offer === undefined ? {} : { offer })
	};
}

/** The chart picker's choices: each use by its library and the line of its call. */
export const chartChoices = ({ uses }: TextCheck): { readonly value: string; readonly label: string }[] =>
	uses.map(({ library, line }, index) => ({ value: String(index), label: `${library}, line ${String(line)}` }));

function drawOf(check: TextCheck, chart: number): Shown['draw'] {
	const use = check.uses[chart];
	if (use === undefined)
		return { kind: 'none', reason: 'No chart config found: nothing hands one to Chart.js, ECharts or Highcharts.' };
	if (!use.complete)
		return {
			kind: 'none',
			reason: 'Not drawn: the config is read only in part, and the chart the source makes may differ.'
		};
	return { kind: 'config', library: use.library, config: use.value };
}

/**
 * The editors' findings about a source text (E56): validator errors and warnings, the review's
 * warnings of configs read completely; nothing when TypeScript cannot read the text. The verdict
 * counts claims; it is no validation status (B1), which belongs to one config.
 */
export function shownSource(check: TextCheck, chart: number): Shown {
	const items = check.findings.map(itemOf);
	const validator = items.filter((_, index) => check.findings[index]?.kind !== 'chart-quality');
	const errors = validator.filter(({ severity }) => severity === 'error').length;
	const use = check.uses[chart];
	const read = use === undefined ? 'no chart' : `${use.library} · read ${use.complete ? 'completely' : 'in part'}`;
	return {
		verdict: check.readable
			? { text: errors > 0 ? `${String(errors)} error(s)` : 'no errors', tone: errors > 0 ? 'error' : 'ok' }
			: { text: 'not readable', tone: 'error' },
		syntax: check.readable ? '' : 'TypeScript cannot read this text (a syntax error or a limit): nothing is claimed.',
		schema: `${String(check.uses.length)} chart(s) · ${read}`,
		summary: `${String(errors)} error(s), ${String(validator.length - errors)} warning(s)`,
		validator,
		quality: items.filter((_, index) => check.findings[index]?.kind === 'chart-quality'),
		draw: drawOf(check, chart),
		fixable: check.findings
			.filter(({ fix, suggestion }) => fix !== undefined || suggestion !== undefined)
			.map(({ code, path }) => `${code} ${path}`)
	};
}

/** A source text as the page shows it: the view, the chart picker's choices and the chart picked. */
export interface SourceView {
	readonly shown: Shown;
	readonly charts: readonly { readonly value: string; readonly label: string }[];
	readonly chart: number;
}

/** The view of `check` with `chart` picked, or the first chart when the text no longer has that many. */
export function sourceView(check: TextCheck, chart: number): SourceView {
	const picked = chart < check.uses.length ? chart : 0;
	return { shown: shownSource(check, picked), charts: chartChoices(check), chart: picked };
}
