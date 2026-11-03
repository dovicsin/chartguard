import { type Diagnostic, locateJsonPath, type Severity } from '@chartguard/core';

import { type Offer, offerOf, type TextEdit } from './edits.js';
import type { LibraryId } from './libraries.js';
import { bySeverity, countBySeverity, type Inspection, lineAndColumn, schemaLabel } from './model.js';

/** One finding as the page lists it: what it says, where its value is in the editor, the fix it offers. */
export interface Item {
	readonly severity: Severity;
	readonly code: string;
	readonly path: string;
	readonly message: string;
	readonly suggestion?: string;
	/** The text the finding is about, selected when it is clicked. */
	readonly range: { readonly start: number; readonly end: number };
	readonly offer?: Offer;
}

/** What the preview draws: a config with its library's runtime, or why nothing is drawn. */
export type Draw =
	| { readonly kind: 'config'; readonly library: LibraryId; readonly config: unknown }
	| { readonly kind: 'none'; readonly reason: string };

/** What the page shows for the editor text, in either input mode. */
export interface Shown {
	readonly verdict: { readonly text: string; readonly tone: string };
	/** The syntax error, if the text cannot be read. */
	readonly syntax: string;
	readonly schema: string;
	readonly summary: string;
	readonly validator: readonly Item[];
	readonly quality: readonly Item[];
	readonly draw: Draw;
	/** The findings (`code path`) the engine offers a fix for, for the self-test. */
	readonly fixable: readonly string[];
}

const TONE: Readonly<Record<string, string>> = { valid: 'ok', partial: 'partial', invalid: 'error' };

const summaryOf = ({ error, warning, info }: Readonly<Record<Severity, number>>): string =>
	`${String(error)} error(s), ${String(warning)} warning(s), ${String(info)} info`;

/** Text that is not JSON: its syntax error, where it is, and nothing checked or drawn. */
function notJson(text: string, offset: number, message: string): Shown {
	const { line, column } = lineAndColumn(text, offset);
	return {
		verdict: { text: 'not JSON', tone: 'error' },
		syntax: `${message} (line ${String(line)}, column ${String(column)})`,
		schema: '',
		summary: '',
		validator: [],
		quality: [],
		draw: { kind: 'none', reason: '' },
		fixable: []
	};
}

/** A finding of a JSON config, located in its text, with its verified fix. */
const jsonItem =
	(checked: Extract<Inspection, { kind: 'checked' }>) =>
	(diagnostic: Diagnostic): Item => {
		const { start, end } = locateJsonPath(checked.tree, diagnostic.path);
		const offer = offerOf(checked, diagnostic);
		const { severity, code, path, message, suggestion } = diagnostic;
		return {
			severity,
			code,
			path,
			message,
			range: { start, end },
			...(suggestion === undefined ? {} : { suggestion }),
			...(offer === undefined ? {} : { offer })
		};
	};

/** A JSON config: every validator and quality finding, located in the JSON text, with its verified fix. */
export function shownJson(text: string, inspection: Inspection, library: LibraryId): Shown {
	if (inspection.kind === 'syntax-error') return notJson(text, inspection.offset, inspection.message);
	const { validation, quality } = inspection;
	const item = jsonItem(inspection);
	const all = [...validation.diagnostics, ...quality.diagnostics];
	return {
		verdict: { text: validation.status, tone: TONE[validation.status] ?? 'muted' },
		syntax: '',
		schema: `schema ${schemaLabel(validation)} · coverage ${validation.coverage}`,
		summary: summaryOf(countBySeverity(validation.diagnostics)),
		validator: bySeverity(validation.diagnostics).map(item),
		quality: quality.diagnostics.map(item),
		draw: { kind: 'config', library, config: inspection.config },
		fixable: all.filter(({ fix }) => fix !== undefined).map(({ code, path }) => `${code} ${path}`)
	};
}

/** A rename's button names the new key as the edit writes it, quotes aside. */
export const renameOffer = (edit: TextEdit): Offer => ({
	label: `Rename to ${edit.text.replace(/^['"]|['"]$/gu, '')}`,
	edit
});
