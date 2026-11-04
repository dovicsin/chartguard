import { join } from 'node:path';

import type { SourceFinding, TextEdit } from '@chartguard/source-checks';

import { Lines, overlaps, type Position, type Range } from './positions.js';
import { pathOf } from './protocol.js';

/** The languages whose documents are checked, with the extension a document without a file name is read as. */
const LANGUAGES: Readonly<Record<string, string>> = {
	javascript: '.js',
	javascriptreact: '.jsx',
	typescript: '.ts',
	typescriptreact: '.tsx'
};

export const isChecked = (languageId: string): boolean => Object.hasOwn(LANGUAGES, languageId);

/** An open document: the editor's text, which may differ from the file on disk, and its findings. */
export interface OpenDocument {
	readonly uri: string;
	readonly languageId: string;
	readonly version: number;
	readonly text: string;
	readonly lines: Lines;
	readonly findings: readonly SourceFinding[];
}

/**
 * The file name a document is checked under: its path for a `file:` URI; otherwise (an unsaved
 * buffer, `untitled:Untitled-1`) its last segment in the workspace, with its language's extension.
 */
export function fileNameOf(uri: string, languageId: string, root: string): string {
	const path = pathOf(uri);
	if (path !== undefined) return path;
	const name = decodeURIComponent(
		uri
			.slice(uri.lastIndexOf(':') + 1)
			.split('/')
			.pop() ?? 'untitled'
	);
	const extension = LANGUAGES[languageId] ?? '.js';
	return join(root, name.endsWith(extension) ? name : `${name}${extension}`);
}

/** LSP's severities: the validator's errors and warnings, quality findings as information (advisory). */
const SEVERITY: Readonly<Record<SourceFinding['kind'], number>> = {
	'valid-config': 1,
	'config-warnings': 2,
	'chart-quality': 3
};

export interface Diagnostic {
	readonly range: Range;
	readonly severity: number;
	readonly source: 'ChartGuard';
	readonly code: SourceFinding['kind'];
	readonly message: string;
}

export const diagnosticOf = ({ lines }: OpenDocument, finding: SourceFinding): Diagnostic => ({
	range: lines.rangeOf(finding.start, finding.end),
	severity: SEVERITY[finding.kind],
	source: 'ChartGuard',
	code: finding.kind,
	message: finding.message
});

const textEdit = ({ lines }: OpenDocument, edit: TextEdit): { range: Range; newText: string } => ({
	range: lines.rangeOf(edit.start, edit.end),
	newText: edit.text
});

/** The annotation an edit that changes the drawing carries: the editor shows it and asks first. */
const CHANGES_DRAWING = 'chartguard.changes-drawing';

/** A workspace edit for a drawing change: confirmed first where the client supports change annotations. */
function suggestedEdit(document: OpenDocument, edit: TextEdit, description: string, annotations: boolean): object {
	const { uri, version } = document;
	if (!annotations) return { changes: { [uri]: [textEdit(document, edit)] } };
	return {
		documentChanges: [
			{ textDocument: { uri, version }, edits: [{ ...textEdit(document, edit), annotationId: CHANGES_DRAWING }] }
		],
		changeAnnotations: { [CHANGES_DRAWING]: { label: 'Changes the drawing', needsConfirmation: true, description } }
	};
}

/**
 * The code actions for the findings in `range`: the runtime's own rename as a preferred quick fix;
 * an edit that changes the drawing as a quick fix never preferred, which the editor asks to confirm
 * where it can (`annotations`).
 */
export function actionsOf(document: OpenDocument, range: Range, annotations: boolean): object[] {
	return document.findings.flatMap((finding) => {
		const diagnostic = diagnosticOf(document, finding);
		if (!overlaps(range, diagnostic.range)) return [];
		const { fix, suggestion } = finding;
		const actions: object[] = [];
		if (fix !== undefined)
			actions.push({
				title: `Rename as the runtime does: ${fix.text.replace(/^['"]|['"]$/gu, '')}`,
				kind: 'quickfix',
				isPreferred: true,
				diagnostics: [diagnostic],
				edit: { changes: { [document.uri]: [textEdit(document, fix)] } }
			});
		if (suggestion !== undefined)
			actions.push({
				title: suggestion.description,
				kind: 'quickfix',
				isPreferred: false,
				diagnostics: [diagnostic],
				edit: suggestedEdit(document, suggestion.edit, suggestion.description, annotations)
			});
		return actions;
	});
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isPosition = (value: unknown): value is Position =>
	isRecord(value) &&
	Number.isSafeInteger(value['line']) &&
	Number.isSafeInteger(value['character']) &&
	(value['line'] as number) >= 0 &&
	(value['character'] as number) >= 0;

/** One change applied to `text`: a whole text, or a text for a range of it; undefined when malformed. */
function applied(text: string, lines: Lines, change: unknown): string | undefined {
	if (!isRecord(change) || typeof change['text'] !== 'string') return undefined;
	if (!Object.hasOwn(change, 'range')) return change['text'];
	const range = change['range'];
	if (!isRecord(range) || !isPosition(range['start']) || !isPosition(range['end'])) return undefined;
	const start = lines.offsetOf(range['start']);
	const end = lines.offsetOf(range['end']);
	return end < start ? undefined : text.slice(0, start) + change['text'] + text.slice(end);
}

/**
 * The text after an editor's content changes (CG-07-03: incremental sync, which VS Code sends at once,
 * where a full text waits 250 ms for more): each change in order, its range in LSP positions of the
 * text the change before it left. Undefined when a change cannot be applied: the text is then unknown.
 */
export function changedText(text: string, lines: Lines, changes: unknown): { text: string; lines: Lines } | undefined {
	if (!Array.isArray(changes)) return undefined;
	let current = { text, lines };
	for (const change of changes) {
		const next = applied(current.text, current.lines, change);
		if (next === undefined) return undefined;
		current = { text: next, lines: new Lines(next) };
	}
	return current;
}
