import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runAsEntryPoint } from '../shared/entry.mjs';

/**
 * Pins the ECharts option documentation anchors deprecation findings may link to (CG-02-06): the
 * option outline the documentation site is built from (Apache-2.0), reduced to the anchors a
 * deprecation finding links to: what replaces a deprecated option, or the option itself. Run by a maintainer; the result is data.
 */
export const OUTLINE = 'https://echarts.apache.org/en/documents/option-parts/option-outline.json';
export const PAGE = 'https://echarts.apache.org/en/option.html';
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const DOCS_FILE = `${ROOT}packages/config/echarts/src/generated/echarts-docs.json`;
const ARTIFACT = `${ROOT}packages/config/echarts/src/generated/echarts-6.1.0.json`;

/** A node's anchor: an option is `parent.prop`; a list item `parent-type`. */
function anchorOf(node, at) {
	if (node.prop !== undefined) return at === '' ? node.prop : `${at}.${node.prop}`;
	return node.arrayItemType === undefined ? at : `${at}-${node.arrayItemType}`;
}

/** Every anchor of the outline: `series-line.label.position` (a list item's type after `-`). */
export function anchorsOf(outline) {
	const anchors = [];
	const visit = (node, at) => {
		const here = anchorOf(node, at);
		if (node.prop !== undefined) anchors.push(here);
		for (const child of node.children ?? []) visit(child, here);
	};
	for (const child of outline.children ?? []) visit(child, '');
	return anchors;
}

const MAX_DEPTH = 8;

/** The literal `type` values a union member declares, through refs. */
function typeLiterals(member, definitions) {
	const node = member.kind === 'ref' ? definitions[member.ref] : member;
	const type = node?.properties?.type?.node;
	if (type?.kind === 'literal') return [String(type.value)];
	return type?.kind === 'union' ? type.anyOf.filter((item) => item.kind === 'literal').map((item) => String(item.value)) : [];
}

/** A deprecated option's anchors: what replaces it (at the same place, or from the option root), then itself. */
function linkTargets(anchor, here, deprecated) {
	const { replacement } = deprecated;
	const parent = anchor === '' ? '' : `${anchor}.`;
	const replaced = typeof replacement === 'string' ? [replacement.includes('.') ? replacement : `${parent}${replacement}`] : [];
	return [...replaced, here];
}

/**
 * The anchors a deprecation finding may link to, walked through the schema the way the documentation
 * names options: `series-pie.label.edgeDistance` (a top-level list's item type after `-`).
 */
export function deprecationAnchors(artifact) {
	const { definitions } = artifact;
	const anchors = new Set();
	const seen = new Set();
	const visitObject = (node, anchor, depth) => {
		for (const [name, property] of Object.entries(node.properties)) {
			const here = anchor === '' ? name : `${anchor}.${name}`;
			if (property.deprecated !== undefined) for (const target of linkTargets(anchor, here, property.deprecated)) anchors.add(target);
			visit(property.node, here, depth + 1);
		}
	};
	const visitUnion = (node, anchor, depth) => {
		for (const member of node.anyOf) {
			visit(member, anchor, depth);
			// Only an item of a top-level list is named by its type in the documentation.
			const literals = depth === 1 ? typeLiterals(member, definitions) : [];
			for (const literal of literals) visit(member, `${anchor}-${literal}`, depth);
		}
	};
	const inner = { ref: (node) => definitions[node.ref], array: (node) => node.items, scriptable: (node) => node.value };
	function visit(node, anchor, depth) {
		const key = `${anchor}|${node.ref ?? ''}|${node.kind}`;
		if (depth > MAX_DEPTH || seen.has(key)) return;
		seen.add(key);
		if (Object.hasOwn(inner, node.kind)) visit(inner[node.kind](node), anchor, depth);
		else if (node.kind === 'union') visitUnion(node, anchor, depth);
		else if (node.kind === 'object') visitObject(node, anchor, depth);
	}
	visit(artifact.root, '', 0);
	return anchors;
}

async function main([retrieved = new Date().toISOString().slice(0, 10)]) {
	const response = await fetch(OUTLINE);
	if (!response.ok) throw new Error(`${OUTLINE}: HTTP ${String(response.status)}`);
	const text = await response.text();
	const wanted = deprecationAnchors(JSON.parse(readFileSync(ARTIFACT, 'utf8')));
	const anchors = [...new Set(anchorsOf(JSON.parse(text)))].filter((anchor) => wanted.has(anchor)).sort();
	const sha256 = createHash('sha256').update(text).digest('hex');
	const pinned = { source: OUTLINE, page: PAGE, retrieved, sha256, license: 'Apache-2.0', anchors };
	writeFileSync(DOCS_FILE, `${JSON.stringify(pinned, null, '\t')}\n`);
	process.stdout.write(`${String(anchors.length)} anchors -> ${DOCS_FILE}\n`);
}

await runAsEntryPoint(import.meta.url, main);
