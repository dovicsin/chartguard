import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const POINTER =
	/'((?:[\w.-]+)@(\d+\.\d+\.\d+) ([\w./-]+):(\d+) [^']*)'|"((?:[\w.-]+)@(\d+\.\d+\.\d+) ([\w./-]+):(\d+) [^"]*)"/g;
const PARTS = /^([\w.-]+)@(\d+\.\d+\.\d+) ([\w./-]+):(\d+) (.+)$/;
/** The quoted text, then the contexts that make it distinctive (` [in …]`, ` [after …]`). */
const CONTEXT = /^(.*?)((?: \[(?:in|after) [^\]]+\])*)$/;
const CONTEXTS = / \[(in|after) ([^\]]+)\]/g;

/** `checkPointers` over every module of a package's `src`; returns how many pointers it checked. */
export function checkPackagePointers(testUrl) {
	const directory = new URL('../src/', testUrl);
	return readdirSync(directory)
		.filter((file) => file.endsWith('.ts'))
		.reduce((count, file) => count + checkPointers(fileURLToPath(new URL(file, directory))), 0);
}

const files = new Map();
const linesOf = (path) => {
	if (!files.has(path)) files.set(path, readFileSync(path, 'utf8').split('\n'));
	return files.get(path);
};

/** How many lines above a pointed line an `[after …]` context may be. */
const WINDOW = 12;

const indentOf = (line) => line.length - line.trimStart().length;

/** Whether `line` holds `text` where it starts (not inside a longer name: `subtext: ''` does not hold `text: ''`). */
function holdsText(line, text) {
	for (let at = line.indexOf(text); at >= 0; at = line.indexOf(text, at + 1))
		if (at === 0 || !/[\w$]/u.test(line[at - 1]) || !/^[\w$]/u.test(text)) return true;
	return false;
}

/** The lines `index` is nested in, innermost first: each non-blank line above it indented less than the last. */
function ancestors(lines, index) {
	const found = [];
	let depth = indentOf(lines[index]);
	for (let above = index - 1; above >= 0 && depth > 0; above -= 1) {
		const line = lines[above];
		if (line.trim() !== '' && indentOf(line) < depth) {
			found.push(line);
			depth = indentOf(line);
		}
	}
	return found;
}

/** Whether the line at `index` is in each context: nested in a line that holds it (`in`), or a few lines after one (`after`). */
function inContexts(lines, index, contexts) {
	const enclosing = contexts.some(({ kind }) => kind === 'in') ? ancestors(lines, index) : [];
	const before = lines.slice(Math.max(0, index - WINDOW), index);
	return contexts.every(({ kind, text }) => (kind === 'in' ? enclosing : before).some((line) => holdsText(line, text)));
}

/** The lines (1-based) that hold `quoted` in every context. */
function places(lines, quoted, contexts) {
	return lines.flatMap((line, index) =>
		holdsText(line, quoted) && inContexts(lines, index, contexts) ? [index + 1] : []
	);
}

/**
 * Every runtime-default pointer written in `source` (`<package>@<version> <file>:<line> <text>`)
 * names the installed, pinned version and exactly one place of that file: the line holds the text and
 * no other line does. A text that is not distinctive alone (`show: true,`) names its contexts: a line
 * it is nested in (` [in TitleModel.defaultOption]`) or one at most `WINDOW` lines above it
 * (` [after mixin(CartesianAxisModel]`), so it cannot point at another option that holds the same text.
 * Returns how many it checked.
 */
export function checkPointers(source) {
	const text = readFileSync(source, 'utf8');
	// A pointer built at runtime (a template or a helper) would escape this check: pointers are literals.
	const built = [...text.matchAll(/`[^`\n]*`/g)]
		.map(([literal]) => literal)
		.filter((literal) => literal.includes('${') && literal.includes('.js:'));
	assert.deepEqual(built, [], `${source}: a pointer is built from parts`);
	const pointers = [...text.matchAll(POINTER)].map((match) => match[1] ?? match[5]);
	for (const pointer of pointers) {
		const [, name, version, file, line, rest] = PARTS.exec(pointer);
		const [, quoted, suffix] = CONTEXT.exec(rest);
		const contexts = [...suffix.matchAll(CONTEXTS)].map(([, kind, said]) => ({ kind, text: said }));
		const manifest = JSON.parse(readFileSync(`${ROOT}node_modules/${name}/package.json`, 'utf8'));
		assert.equal(manifest.version, version, `${pointer}: installed ${name} is ${manifest.version}`);
		const lines = linesOf(`${ROOT}node_modules/${name}/${file}`);
		assert.ok(
			lines[Number(line) - 1]?.includes(quoted.trim()),
			`${pointer}: line ${line} is "${lines[Number(line) - 1]?.trim()}"`
		);
		const found = places(lines, quoted.trim(), contexts);
		assert.deepEqual(
			found,
			[Number(line)],
			`${pointer}: the text in its contexts is on lines ${found.join(', ')}; name a context (\` [in …]\`, \` [after …]\`)`
		);
	}
	return pointers.length;
}
