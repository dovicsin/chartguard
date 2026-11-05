import { join } from 'node:path';

import type { SourceFinding, TextEdit } from '@chartguard/source-checks';

import type { Lines } from './positions.js';
import { overlaps, type Range } from './positions.js';
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
	/** Where the finding is explained: the editor links the code to it. */
	readonly codeDescription?: { readonly href: string };
	readonly message: string;
}

/** What the client declared it supports, which decides the shape of what is sent to it. */
export interface ClientSupport {
	/** Change annotations in document changes: an edit that changes the drawing is confirmed first. */
	readonly annotations: boolean;
	/** `codeDescription` on a diagnostic: its code links to where the finding is explained. */
	readonly links: boolean;
}

export const diagnosticOf = (
	{ lines }: OpenDocument,
	finding: SourceFinding,
	{ links }: Pick<ClientSupport, 'links'>
): Diagnostic => ({
	range: lines.rangeOf(finding.start, finding.end),
	severity: SEVERITY[finding.kind],
	source: 'ChartGuard',
	code: finding.kind,
	...(links && finding.documentationUrl !== undefined ? { codeDescription: { href: finding.documentationUrl } } : {}),
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
 * where it can (`client.annotations`).
 */
export function actionsOf(document: OpenDocument, range: Range, client: ClientSupport): object[] {
	return document.findings.flatMap((finding) => {
		const diagnostic = diagnosticOf(document, finding, client);
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
				edit: suggestedEdit(document, suggestion.edit, suggestion.description, client.annotations)
			});
		return actions;
	});
}
