import type { Diagnostic } from './diagnostic.js';

/**
 * The published reference (CG-06-07): the repository's GitHub Pages site, with the reference at
 * `/reference/`. Its codes page has an anchor for every code a package emits, the quality codes
 * included, so a link is formed from the code alone and core still knows no code.
 */
export const REFERENCE_URL = 'https://dovicsin.github.io/chartguard/reference/';

/** Where `code` is explained: its anchor on the reference's codes page. */
export function referenceUrl(code: string): string {
	return `${REFERENCE_URL}codes.html#${encodeURIComponent(code)}`;
}

/**
 * The finding with a link to where it is explained: its own when it has one (a migration page the
 * adapter names), else its code's anchor in the reference.
 */
export function documented(diagnostic: Diagnostic): Diagnostic {
	return diagnostic.documentationUrl === undefined
		? { ...diagnostic, documentationUrl: referenceUrl(diagnostic.code) }
		: diagnostic;
}
