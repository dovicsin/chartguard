import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

import { InputError } from './errors.js';

/**
 * The files an invocation reads (CG-06-02 part 2): each `--file` a path, or a pattern matched
 * against paths relative to the working directory (`/` on every platform). A walk stays below the
 * pattern's literal prefix, never enters `node_modules` or `.git` and never follows a link to a
 * directory; it is bounded in files.
 */
const GLOB = /[*?{]/u;
const MAX_FILES = 10_000;
const NEVER_WALKED: ReadonlySet<string> = new Set(['node_modules', '.git']);

export const isPattern = (input: string): boolean => GLOB.test(input);

const escape = (character: string): string => character.replace(/[$()*+.?[\\\]^{|}]/u, '\\$&');

/** The index of the `}` closing the `{` at `open`, alternatives may nest; -1 when unclosed. */
function closing(pattern: string, open: number): number {
	let depth = 0;
	for (let index = open; index < pattern.length; index++) {
		if (pattern[index] === '{') depth += 1;
		if (pattern[index] === '}') depth -= 1;
		if (depth === 0) return index;
	}
	return -1;
}

/** The top-level alternatives of `{a,b{c,d}}`'s inside. */
function alternatives(inside: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let index = 0; index < inside.length; index++) {
		if (inside[index] === '{') depth += 1;
		else if (inside[index] === '}') depth -= 1;
		else if (inside[index] === ',' && depth === 0) {
			parts.push(inside.slice(start, index));
			start = index + 1;
		}
	}
	return [...parts, inside.slice(start)];
}

/** `**` as a whole segment: any number of directories, none hidden. */
function globstar(pattern: string, index: number): { readonly source: string; readonly next: number } {
	if (pattern[index + 2] === '/') return { source: '(?:(?!\\.)[^/]*/)*', next: index + 3 };
	return { source: '(?:(?!\\.)[^/]*(?:/(?!\\.)[^/]*)*)?', next: index + 2 };
}

/** What `*` and `?` match within one segment. */
const WILDCARDS: Readonly<Partial<Record<string, string>>> = { '*': '[^/]*', '?': '[^/]' };

/** One step of a pattern at `index`: its regular expression source and where the next step starts. */
function stepAt(pattern: string, index: number): { readonly source: string; readonly next: number } {
	const character = pattern[index] ?? '';
	const segmentStart = index === 0 || pattern[index - 1] === '/';
	if (character === '*' && pattern[index + 1] === '*' && segmentStart) return globstar(pattern, index);
	const any = WILDCARDS[character];
	// A `*` or `?` that starts a segment never matches a leading dot.
	if (any !== undefined) return { source: `${segmentStart ? '(?!\\.)' : ''}${any}`, next: index + 1 };
	const end = character === '{' ? closing(pattern, index) : -1;
	if (end === -1) return { source: escape(character), next: index + 1 };
	const inside = alternatives(pattern.slice(index + 1, end)).map(sourceOf);
	return { source: `(?:${inside.join('|')})`, next: end + 1 };
}

/** The regular expression source of a pattern. */
function sourceOf(pattern: string): string {
	let source = '';
	for (let index = 0; index < pattern.length;) {
		const step = stepAt(pattern, index);
		source += step.source;
		index = step.next;
	}
	return source;
}

/** Whether a `/`-separated relative path matches the pattern. */
export function globMatcher(pattern: string): (path: string) => boolean {
	const expression = new RegExp(`^${sourceOf(pattern)}$`, 'u');
	return (path) => expression.test(path);
}

/** A path relative to the working directory, with `/` on every platform. */
const relativePath = (path: string, cwd: string): string => relative(cwd, resolve(cwd, path)).split(sep).join('/');

/** The directory a pattern's walk starts at: its segments before the first with a pattern character. */
function baseOf(pattern: string): string {
	const segments = pattern.split('/');
	const literal = segments.findIndex((segment) => isPattern(segment));
	return segments.slice(0, literal).join('/');
}

/** Whether a walk enters this entry as a directory: a real one, never a link, never `node_modules` or `.git`. */
const entered = (entry: Dirent): boolean => entry.isDirectory() && !NEVER_WALKED.has(entry.name);

/** Whether this entry is a file to match: a file, or a link to one. */
async function matchable(entry: Dirent, path: string): Promise<boolean> {
	return entry.isFile() || (entry.isSymbolicLink() && (await isFile(path)));
}

/** Every file below `directory` (relative to `cwd`), not entering links to directories, `node_modules` or `.git`. */
async function walk(directory: string, cwd: string, found: string[]): Promise<void> {
	let entries: Dirent[];
	try {
		entries = await readdir(join(cwd, directory), { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const path = directory === '' ? entry.name : `${directory}/${entry.name}`;
		if (entered(entry)) await walk(path, cwd, found);
		else if (await matchable(entry, join(cwd, path))) {
			if (found.length >= MAX_FILES)
				throw new InputError(
					`more than ${String(MAX_FILES)} files below ${directory === '' ? '.' : directory}; narrow the pattern.`
				);
			found.push(path);
		}
	}
}

async function isFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

/**
 * The files the inputs name, each once, in code-unit order of their paths relative to the working
 * directory (never the locale's, D13), without those an ignore matches. A literal path is used as
 * given (a file the analysis names in its findings as the user wrote it); a pattern's matches are
 * relative paths; a pattern that matches nothing is the user's input to fix.
 */
export async function expandInputs(
	inputs: readonly string[],
	ignores: readonly string[],
	cwd: string = process.cwd()
): Promise<string[]> {
	const ignored = ignores.map(globMatcher);
	// By resolved path: `a.json` and `./a.json` are one file.
	const files = new Map<string, { readonly given: string; readonly path: string }>();
	for (const input of inputs) {
		const found = isPattern(input) ? await matchesOf(input, cwd) : [input];
		for (const given of found) files.set(resolve(cwd, given), { given, path: relativePath(given, cwd) });
	}
	return [...files.values()]
		.filter(({ path }) => !ignored.some((matches) => matches(path)))
		.sort((a, b) => (a.path < b.path ? -1 : 1))
		.map(({ given }) => given);
}

/** The files a pattern matches, relative to `cwd`. */
async function matchesOf(input: string, cwd: string): Promise<string[]> {
	const pattern = input.split(sep).join('/');
	const found: string[] = [];
	await walk(baseOf(pattern), cwd, found);
	const matches = found.filter(globMatcher(pattern));
	if (matches.length === 0) throw new InputError(`${input} matches no file.`);
	return matches;
}
