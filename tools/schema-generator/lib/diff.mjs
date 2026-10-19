import { omit } from './digest.mjs';

/**
 * Semantic diff of two SchemaIR artifacts. Definitions are matched by their canonical path, the
 * first path that reaches them in a breadth-first walk from the root, never by name: definition
 * names come from TypeScript's type printer and change with it.
 */

const resolveIn = (definitions) => (node) => (node.kind === 'ref' ? definitions[node.ref] : node);

/**
 * `<type=bar>` for a discriminated member. Other members add nothing, so wrapping a value in a
 * union (`T` → `boolean | T`) keeps its path; collisions are numbered in `canonicalPaths`.
 */
function memberLabel(union, member, resolve) {
	const literal = union.discriminator === undefined ? undefined : resolve(member)?.properties?.[union.discriminator]?.node;
	return literal?.kind === 'literal' ? `<${union.discriminator}=${String(literal.value)}>` : '';
}

/** Every `ref` directly inside a node, with the path it is reached at. */
function references(node, path, resolve) {
	const found = [];
	const visit = (current, at) => {
		switch (current.kind) {
			case 'ref':
				found.push([at, current.ref]);
				return;
			case 'object':
				for (const [key, property] of Object.entries(current.properties)) visit(property.node, `${at}.${key}`);
				return;
			case 'record':
				visit(current.values, `${at}[*]`);
				return;
			case 'array':
				visit(current.items, `${at}[]`);
				return;
			case 'scriptable':
				visit(current.value, at);
				return;
			case 'union':
				for (const member of current.anyOf) visit(member, `${at}${memberLabel(current, member, resolve)}`);
		}
	};
	visit(node, path);
	return found;
}

/** Definition name → canonical path, in breadth-first order from the root; a taken path gets `~2`, `~3`. */
export function canonicalPaths(artifact) {
	const resolve = resolveIn(artifact.definitions);
	const paths = new Map();
	const taken = new Set();
	const queue = [['$', artifact.root]];
	while (queue.length > 0) {
		const [path, node] = queue.shift();
		for (const [at, ref] of references(node, path, resolve)) {
			if (paths.has(ref)) continue;
			let unique = at;
			for (let suffix = 2; taken.has(unique); suffix++) unique = `${at}~${String(suffix)}`;
			taken.add(unique);
			paths.set(ref, unique);
			queue.push([unique, artifact.definitions[ref]]);
		}
	}
	return paths;
}

/** A node with references replaced by canonical paths and provenance dropped: what it validates. */
function signature(node, paths) {
	if (Array.isArray(node)) return node.map((entry) => signature(entry, paths));
	if (node === null || typeof node !== 'object') return node;
	if (node.kind === 'ref') return { ref: paths.get(node.ref) ?? `?${node.ref}` };
	return Object.fromEntries(
		Object.entries(node)
			.filter(([key]) => key !== 'provenance' && key !== 'docs')
			.map(([key, value]) => [key, signature(value, paths)])
	);
}

const UNION_FIELDS = ['discriminator', 'defaultVariant', 'defaultWhen', 'extensible'];

function compareObjects(path, before, after, changes) {
	const keys = new Set([...Object.keys(before.properties), ...Object.keys(after.properties)]);
	for (const key of [...keys].sort(compareText)) {
		const at = `${path}.${key}`;
		const [old, next] = [before.properties[key], after.properties[key]];
		if (old === undefined) changes.push({ kind: 'property-added', path: at, after: next.node });
		else if (next === undefined) changes.push({ kind: 'property-removed', path: at, before: old.node });
		else {
			if ((old.required === true) !== (next.required === true))
				changes.push({ kind: 'required-changed', path: at, before: old.required === true, after: next.required === true });
			if (JSON.stringify(old.node) !== JSON.stringify(next.node))
				changes.push({ kind: 'property-changed', path: at, before: old.node, after: next.node });
		}
	}
	if (before.additional !== after.additional)
		changes.push({ kind: 'openness-changed', path, before: before.additional, after: after.additional });
}

/** A union without its selection fields, which are reported on their own. */
const withoutUnionFields = (node) => omit(node, UNION_FIELDS);

function compareDefinitions(path, before, after, changes) {
	if (before.kind === 'object' && after.kind === 'object') {
		compareObjects(path, before, after, changes);
		return;
	}
	if (before.kind === 'union' && after.kind === 'union') {
		for (const field of UNION_FIELDS)
			if (JSON.stringify(before[field]) !== JSON.stringify(after[field]))
				changes.push({ kind: `${field}-changed`, path, before: before[field], after: after[field] });
		if (JSON.stringify(withoutUnionFields(before)) === JSON.stringify(withoutUnionFields(after))) return;
	}
	changes.push({ kind: 'definition-changed', path, before, after });
}

/** Code-point order: `localeCompare` depends on the machine's locale, a diff must not. */
const compareText = (left, right) => (left < right ? -1 : Number(left > right));

/** The changes from `before` to `after`, each at a canonical path, sorted by path. */
export function diffArtifacts(before, after) {
	const [oldPaths, newPaths] = [canonicalPaths(before), canonicalPaths(after)];
	const byPath = (artifact, paths) =>
		new Map([...paths].map(([name, path]) => [path, signature(artifact.definitions[name], paths)]));
	const [oldDefinitions, newDefinitions] = [byPath(before, oldPaths), byPath(after, newPaths)];
	const changes = [];
	const rootBefore = signature(before.root, oldPaths);
	const rootAfter = signature(after.root, newPaths);
	if (JSON.stringify(rootBefore) !== JSON.stringify(rootAfter)) compareDefinitions('$', rootBefore, rootAfter, changes);
	for (const path of new Set([...oldDefinitions.keys(), ...newDefinitions.keys()])) {
		const [old, next] = [oldDefinitions.get(path), newDefinitions.get(path)];
		if (old === undefined) changes.push({ kind: 'definition-added', path, after: next });
		else if (next === undefined) changes.push({ kind: 'definition-removed', path, before: old });
		else if (JSON.stringify(old) !== JSON.stringify(next)) compareDefinitions(path, old, next, changes);
	}
	return changes.sort((left, right) => compareText(left.path, right.path) || compareText(left.kind, right.kind));
}

const brief = (value) => {
	const text = JSON.stringify(value);
	return text === undefined || text.length <= 100 ? String(text) : `${text.slice(0, 97)}...`;
};

const DETAIL = {
	'+': ({ after }) => brief(after),
	'-': ({ before }) => brief(before),
	'~': ({ before, after }) => `${brief(before)} -> ${brief(after)}`
};

/** One line per change: `~ $<type=bar>.options.responsive (property-changed): {...} -> {...}`. */
export function formatDiff(changes) {
	const marks = { 'property-added': '+', 'definition-added': '+', 'property-removed': '-', 'definition-removed': '-' };
	return changes.map((change) => {
		const mark = marks[change.kind] ?? '~';
		return `${mark} ${change.path} (${change.kind}): ${DETAIL[mark](change)}`;
	});
}
