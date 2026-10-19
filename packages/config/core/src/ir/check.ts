import { isRecord } from '@chartguard/core';

import { checkUnionOptions, isNonEmpty, LITERAL_TYPES } from './check-union.js';
import { checkHeader, checkSources, quote, type Report } from './header.js';
import { CONFIDENCE_TIERS, NODE_KINDS, OPENNESS, type SchemaArtifact } from './types.js';

const MAX_DEPTH = 200;
const CONFIDENCE_SET: ReadonlySet<unknown> = new Set(CONFIDENCE_TIERS);
const OPENNESS_SET: ReadonlySet<unknown> = new Set(OPENNESS);

export interface ArtifactCheck {
	/** Present only when there are no problems. */
	readonly artifact: SchemaArtifact | undefined;
	readonly problems: readonly string[];
}

type Node = Record<string, unknown>;
type ChildCheck = (checker: NodeChecker, node: Node, path: string, depth: number) => void;

function isHandler(value: unknown): boolean {
	return (
		isRecord(value) && isNonEmpty(value['id']) && isNonEmpty(value['name']) && typeof value['enforced'] === 'boolean'
	);
}

/** A member's discriminator property must be a literal (or a union of literals) so it can select the member. */
function hasLiteralDiscriminator(member: Node, key: string): boolean {
	const properties = member['properties'];
	const property = isRecord(properties) ? properties[key] : undefined;
	const node = isRecord(property) ? property['node'] : undefined;
	if (!isRecord(node)) return false;
	if (node['kind'] === 'literal') return true;
	return (
		node['kind'] === 'union' &&
		Array.isArray(node['anyOf']) &&
		node['anyOf'].every((item) => isRecord(item) && item['kind'] === 'literal')
	);
}

const CHILD_CHECKS: Partial<Record<string, ChildCheck>> = {
	object: (checker, node, path, depth) => {
		checker.checkProperties(node['properties'], `${path}.properties`, depth);
		if (!OPENNESS_SET.has(node['additional']))
			checker.report(path, 'expected additional to be "closed", "open" or "unknown"');
		checker.checkIncludes(node['includes'], path);
		if (node['nullAsAbsent'] !== undefined && typeof node['nullAsAbsent'] !== 'boolean')
			checker.report(path, 'nullAsAbsent must be a boolean');
		if (node['extensionPoint'] !== undefined && !isNonEmpty(node['extensionPoint']))
			checker.report(path, 'extensionPoint must be a non-empty string');
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
				checker.checkDiscriminated(member, node['discriminator'], `${path}.anyOf[${String(index)}]`);
			});
		checkUnionOptions(checker, node, path, Array.isArray(members) ? members.length : 0);
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
		const siblings = new Set(Object.keys(value));
		for (const [key, property] of Object.entries(value))
			this.checkProperty(property, `${path}.${key}`, depth, siblings);
	}

	private checkProperty(property: unknown, path: string, depth: number, siblings: ReadonlySet<string>): void {
		if (!isRecord(property)) {
			this.report(path, 'expected an object');
			return;
		}
		this.checkProvenance(property['provenance'], `${path}.provenance`);
		if (property['required'] !== undefined && typeof property['required'] !== 'boolean')
			this.report(path, 'required must be a boolean');
		const { handledBy } = property;
		if (handledBy !== undefined && !isHandler(handledBy))
			this.report(path, 'handledBy must be { id: <non-empty string>, name: <non-empty string>, enforced: <boolean> }');
		this.checkDeprecation(property['deprecated'], path, siblings);
		this.checkNode(property['node'], `${path}.node`, depth + 1);
	}

	/** A deprecation is strings only; a rename target must be a sibling the same object declares. */
	private checkDeprecation(deprecated: unknown, path: string, siblings: ReadonlySet<string>): void {
		if (deprecated === undefined) return;
		if (!isRecord(deprecated) || !Object.values(deprecated).every((field) => typeof field === 'string')) {
			this.report(path, 'deprecated must be { since?, replacement?, message?, renameTo? } of strings');
			return;
		}
		const { renameTo } = deprecated;
		if (typeof renameTo === 'string' && !siblings.has(renameTo))
			this.report(path, `deprecated renameTo ${quote(renameTo)} is not a sibling property`);
	}

	checkRef(ref: unknown, path: string): void {
		if (typeof ref !== 'string' || !Object.hasOwn(this.definitions, ref))
			this.report(path, `unresolved ref ${quote(ref)}`);
	}

	checkIncludes(includes: unknown, path: string): void {
		if (includes === undefined) return;
		const isObjectDefinition = (name: unknown): boolean => {
			const target =
				typeof name === 'string' && Object.hasOwn(this.definitions, name) ? this.definitions[name] : undefined;
			return isRecord(target) && target['kind'] === 'object';
		};
		if (!Array.isArray(includes) || !includes.every(isObjectDefinition))
			this.report(path, 'includes must name object definitions');
	}

	/** Object members of a discriminated union (inline or by ref) must carry a literal discriminator. */
	checkDiscriminated(member: unknown, key: unknown, path: string): void {
		if (typeof key !== 'string') return;
		const target = isRecord(member) && member['kind'] === 'ref' ? this.definitions[String(member['ref'])] : member;
		if (!isRecord(target) || target['kind'] !== 'object') return;
		if (!hasLiteralDiscriminator(target, key))
			this.report(path, `discriminator "${key}" must be a literal property of every object member`);
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
