import { isRecord } from '@chartguard/core';

import { checkHeader, checkSources, quote, type Report } from './header.js';
import { CONFIDENCE_TIERS, NODE_KINDS, OPENNESS, type SchemaArtifact } from './types.js';

const MAX_DEPTH = 200;
const CONFIDENCE_SET: ReadonlySet<unknown> = new Set(CONFIDENCE_TIERS);
const OPENNESS_SET: ReadonlySet<unknown> = new Set(OPENNESS);
const LITERAL_TYPES: ReadonlySet<string> = new Set(['string', 'number', 'boolean']);

export interface ArtifactCheck {
	/** Present only when there are no problems. */
	readonly artifact: SchemaArtifact | undefined;
	readonly problems: readonly string[];
}

type Node = Record<string, unknown>;
type ChildCheck = (checker: NodeChecker, node: Node, path: string, depth: number) => void;

const CHILD_CHECKS: Partial<Record<string, ChildCheck>> = {
	object: (checker, node, path, depth) => {
		checker.checkProperties(node['properties'], `${path}.properties`, depth);
		if (!OPENNESS_SET.has(node['additional']))
			checker.report(path, 'expected additional to be "closed", "open" or "unknown"');
	},
	record: (checker, node, path, depth) => {
		checker.checkNode(node['values'], `${path}.values`, depth + 1);
	},
	array: (checker, node, path, depth) => {
		checker.checkNode(node['items'], `${path}.items`, depth + 1);
	},
	scriptable: (checker, node, path, depth) => {
		checker.checkNode(node['value'], `${path}.value`, depth + 1);
	},
	union: (checker, node, path, depth) => {
		const members = node['anyOf'];
		if (!Array.isArray(members) || members.length === 0) checker.report(path, 'expected a non-empty anyOf array');
		else
			members.forEach((member, index) => {
				checker.checkNode(member, `${path}.anyOf[${String(index)}]`, depth + 1);
			});
	},
	ref: (checker, node, path) => {
		checker.checkRef(node['ref'], path);
	},
	literal: (checker, node, path) => {
		const { value } = node;
		if (value !== null && !LITERAL_TYPES.has(typeof value)) checker.report(path, 'expected a primitive literal value');
	}
};

class NodeChecker {
	constructor(
		readonly report: Report,
		private readonly sources: Record<string, unknown>,
		private readonly definitions: Record<string, unknown>
	) {}

	checkNode(value: unknown, path: string, depth: number): void {
		if (depth > MAX_DEPTH) {
			this.report(path, `exceeds maximum depth ${String(MAX_DEPTH)}`);
			return;
		}
		if (!isRecord(value)) {
			this.report(path, 'expected an object');
			return;
		}
		const { kind } = value;
		if (typeof kind !== 'string' || !NODE_KINDS.has(kind)) {
			this.report(path, `unknown node kind ${quote(kind)}`);
			return;
		}
		if (value['provenance'] !== undefined) this.checkProvenance(value['provenance'], `${path}.provenance`);
		CHILD_CHECKS[kind]?.(this, value, path, depth);
	}

	checkProperties(value: unknown, path: string, depth: number): void {
		if (!isRecord(value)) {
			this.report(path, 'expected an object');
			return;
		}
		for (const [key, property] of Object.entries(value)) {
			const propertyPath = `${path}.${key}`;
			if (!isRecord(property)) this.report(propertyPath, 'expected an object');
			else {
				this.checkProvenance(property['provenance'], `${propertyPath}.provenance`);
				this.checkNode(property['node'], `${propertyPath}.node`, depth + 1);
			}
		}
	}

	checkRef(ref: unknown, path: string): void {
		if (typeof ref !== 'string' || !Object.hasOwn(this.definitions, ref))
			this.report(path, `unresolved ref ${quote(ref)}`);
	}

	private checkProvenance(value: unknown, path: string): void {
		if (!isRecord(value)) {
			this.report(path, 'expected an object');
			return;
		}
		const { confidence, sources } = value;
		if (!CONFIDENCE_SET.has(confidence)) {
			this.report(path, `unknown confidence ${quote(confidence)}`);
			return;
		}
		if (!Array.isArray(sources)) {
			this.report(path, 'expected sources to be an array');
			return;
		}
		if (confidence === 'authoritative' && sources.length === 0)
			this.report(path, 'authoritative provenance needs at least one source');
		for (const reference of sources) this.checkSourceRef(reference, confidence === 'authoritative', path);
	}

	private checkSourceRef(reference: unknown, authoritative: boolean, path: string): void {
		if (!isRecord(reference)) {
			this.report(path, 'expected { source } references');
			return;
		}
		const id = reference['source'];
		if (typeof id !== 'string' || !Object.hasOwn(this.sources, id)) {
			this.report(path, `unknown source ${quote(id)}`);
			return;
		}
		const source = this.sources[id];
		if (authoritative && !(isRecord(source) && typeof source['integrity'] === 'string'))
			this.report(path, `authoritative source "${id}" has no integrity pin`);
	}
}

/** Structural and provenance check of an untrusted artifact. Never throws. */
export function checkArtifact(value: unknown): ArtifactCheck {
	const problems: string[] = [];
	const report: Report = (path, message) => problems.push(`${path}: ${message}`);
	if (!isRecord(value)) {
		report('$', 'expected an object');
		return { artifact: undefined, problems };
	}
	checkHeader(value, report);
	const definitions = isRecord(value['definitions']) ? value['definitions'] : {};
	if (!isRecord(value['definitions'])) report('$.definitions', 'expected an object');
	const checker = new NodeChecker(report, checkSources(value['sources'], report), definitions);
	for (const [name, node] of Object.entries(definitions)) checker.checkNode(node, `$.definitions.${name}`, 0);
	checker.checkNode(value['root'], '$.root', 0);
	// Every field was verified above, so the assertion only names the shape.
	return { artifact: problems.length === 0 ? (value as unknown as SchemaArtifact) : undefined, problems };
}
