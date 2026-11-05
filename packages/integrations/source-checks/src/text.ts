/**
 * The source checks of one text read alone, without Node (CG-06-06 part 3): what a browser can run.
 * The same findings as `SourceChecker` gives for a file read alone (E56); no project, no install,
 * no built schema: the caller's engine says which validators check which library.
 */
import { type ChartUse, extractStaticConfigs } from '@chartguard/analysis-typescript';
import ts from 'typescript';

import { type Engine, findingsOf, type Reading, type SourceFinding } from './findings.js';

export type { TextEdit } from './edits.js';
export type { Engine, FindingKind, SourceFinding } from './findings.js';

/** What `checkText` read of one text and found in it. */
export interface TextCheck {
	/** False when TypeScript cannot read the text (syntax errors, limits): then nothing is claimed (A7). */
	readonly readable: boolean;
	/** The configs the text hands to a chart library, as read; `complete` false when a part could not be. */
	readonly uses: readonly ChartUse[];
	readonly findings: readonly SourceFinding[];
}

/** Reads `text` as the file `fileName` (its extension picks JavaScript, TypeScript, JSX) and checks its uses. */
export function checkText(text: string, fileName: string, engine: Engine): TextCheck {
	const { readable, uses } = extractStaticConfigs(text, fileName);
	if (!readable) return { readable, uses, findings: [] };
	// Read alone, nothing is followed into another file: every range the analysis gives is in `text`.
	const reading: Reading = {
		file: ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true),
		inFile: () => true,
		where: (range) => range.file
	};
	return { readable, uses, findings: findingsOf(uses, reading, engine) };
}
