import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sourceDirectory } from './lock.mjs';

const POINTER = /^(?<path>[^:]+):(?<line>[1-9]\d*)$/u;
/** The name a property declaration line starts with (`readonly 'name'?: …`, `name(…)`). */
const DECLARED = /^\s*(?:readonly\s+)?['"]?(?<name>[\w$]+)['"]?\??\s*[:(<]/u;
/** A mapped type (`[P in keyof T]`): the keys it synthesizes cite it, not a line of their own. */
const MAPPED = /\[\s*[\w$]+\s+in\s/u;
const IDENTIFIER = /[\w$]/u;

/** `chart.js` for `chart.js@4.5.1`, `@scope/name` for `@scope/name@1.0.0`. */
const packageOf = (locator) => locator.slice(0, locator.lastIndexOf('@'));

/** Whether `line` names `name` as a whole word (not inside a longer identifier). */
function names(line, name) {
	for (let at = line.indexOf(name); at !== -1; at = line.indexOf(name, at + 1)) {
		const before = line[at - 1] ?? ' ';
		const after = line[at + name.length] ?? ' ';
		if (!IDENTIFIER.test(before) && !IDENTIFIER.test(after)) return true;
	}
	return false;
}

/**
 * Whether the declaration a property cites at `index` declares `name`: the line names it, or a key
 * remapping derives it (`pointRadius` from `radius` under `point${Capitalize<K>}`), or a mapped type
 * there synthesizes it.
 */
function declares(lines, index, name) {
	const line = lines[index];
	if (names(line, name)) return true;
	const declared = DECLARED.exec(line)?.groups?.name;
	if (declared !== undefined && name.endsWith(declared[0].toUpperCase() + declared.slice(1))) return true;
	return MAPPED.test(`${line}\n${lines[index + 1] ?? ''}`);
}

/** The child nodes of a node, by its kind (D17: structure comes from kinds and known fields, never from key names). */
function childrenOf(node, path) {
	switch (node.kind) {
		case 'record':
			return [{ node: node.values, path: `${path}.values` }];
		case 'array':
			return [{ node: node.items, path: `${path}.items` }];
		case 'scriptable':
			return [{ node: node.value, path: `${path}.value` }];
		case 'union':
			return node.anyOf.map((member, index) => ({ node: member, path: `${path}.anyOf[${String(index)}]` }));
		default:
			return [];
	}
}

/** Every provenance record of an artifact (of a node, or of a property with its name). */
function* records(artifact) {
	const stack = [
		{ node: artifact.root, path: 'root' },
		...Object.entries(artifact.definitions).map(([name, node]) => ({ node, path: `definitions.${name}` }))
	];
	while (stack.length > 0) {
		const { node, path } = stack.pop();
		if (node.provenance !== undefined) yield { provenance: node.provenance, path };
		for (const [name, property] of node.kind === 'object' ? Object.entries(node.properties) : []) {
			yield { provenance: property.provenance, path: `${path}.properties.${name}`, name };
			stack.push({ node: property.node, path: `${path}.properties.${name}.node` });
		}
		stack.push(...childrenOf(node, path));
	}
}

/** Reads each file once; `undefined` for one that does not exist. */
function fileLines() {
	const files = new Map();
	return (path) => {
		if (!files.has(path)) files.set(path, existsSync(path) ? readFileSync(path, 'utf8').split('\n') : undefined);
		return files.get(path);
	};
}

/** The lines of the file a pointer names and the index of its line, or why it names none. */
function citedLine({ source, pointer }, recorded, linesOf) {
	const parts = POINTER.exec(pointer)?.groups;
	if (parts === undefined || recorded === undefined || !parts.path.startsWith(`${recorded.name}/`))
		return { problem: `is not a line of a file of source "${source}"` };
	const relative = parts.path.slice(recorded.name.length + 1);
	const lines = relative.split('/').includes('..') ? undefined : linesOf(join(recorded.directory, relative));
	const index = Number(parts.line) - 1;
	if (lines === undefined || index >= lines.length) return { problem: `names no line of ${recorded.name}` };
	return { lines, index, declaration: relative.endsWith('.d.ts') };
}

/** The problem of one source reference, if any. `name`: the property it is the provenance of, when held to its line. */
function problemOf(reference, recorded, linesOf, name) {
	const { problem, lines, index, declaration } = citedLine(reference, recorded, linesOf);
	if (problem !== undefined) return problem;
	return name !== undefined && declaration && !declares(lines, index, name) ? `does not declare "${name}"` : undefined;
}

/**
 * The provenance problems of `artifact`, built from the install under `root` (CG-07-06). Each pointer
 * must name a file of the package its source records (the library under `root`, the compiler this
 * generator loads) and a line in it; the declaration an authoritative property cites first must
 * declare that property. A generated artifact is never written with one (D19).
 * @returns {string[]}
 */
export function untracedFacts(root, artifact) {
	const recorded = new Map(
		Object.entries(artifact.sources).map(([id, { locator }]) => {
			const name = packageOf(locator);
			return [id, { name, directory: sourceDirectory(root, name) }];
		})
	);
	const linesOf = fileLines();
	const problems = [];
	for (const { provenance, path, name } of records(artifact))
		for (const [index, reference] of provenance.sources.entries()) {
			if (reference.pointer === undefined) continue;
			const held = index === 0 && provenance.confidence === 'authoritative' ? name : undefined;
			const problem = problemOf(reference, recorded.get(reference.source), linesOf, held);
			if (problem !== undefined) problems.push(`${path}: ${reference.pointer} ${problem}`);
		}
	return problems;
}
