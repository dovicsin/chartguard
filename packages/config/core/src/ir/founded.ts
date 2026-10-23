import { isRecord } from '@chartguard/core';

type Node = Record<string, unknown>;
type Definitions = Readonly<Record<string, unknown>>;

const membersOf = (node: Node): readonly unknown[] => (Array.isArray(node['anyOf']) ? node['anyOf'] : []);
const refOf = (node: Node): string | undefined => (node['kind'] === 'ref' ? String(node['ref']) : undefined);

/** Whether `node` reaches a shape, given the definitions known to: a union through any member. */
function reaches(node: unknown, shaped: ReadonlySet<string>, definitions: Definitions): boolean {
	if (!isRecord(node)) return true;
	const ref = refOf(node);
	// An unresolved reference is reported on its own.
	if (ref !== undefined) return shaped.has(ref) || !Object.hasOwn(definitions, ref);
	if (node['kind'] !== 'union') return true;
	return membersOf(node).some((member) => reaches(member, shaped, definitions));
}

/**
 * The definitions that never reach a shape: an alias of an alias of itself (`A = B`, `B = A`) or a
 * union whose only members are such definitions or itself. They describe no value; lowered as one,
 * they would be an empty schema checked as complete (H6). The least fixpoint: a definition reaches a
 * shape only through one that does.
 */
export function shapeless(definitions: Definitions): ReadonlySet<string> {
	const shaped = new Set<string>();
	for (let grew = true; grew;) {
		grew = false;
		for (const [name, node] of Object.entries(definitions))
			if (!shaped.has(name) && reaches(node, shaped, definitions)) {
				shaped.add(name);
				grew = true;
			}
	}
	return new Set(Object.keys(definitions).filter((name) => !shaped.has(name)));
}

/** The node a reference leads to, through aliases; undefined for a missing or looping one. */
function target(node: unknown, definitions: Definitions, seen = new Set<string>()): Node | undefined {
	if (!isRecord(node)) return undefined;
	const ref = refOf(node);
	if (ref === undefined) return node;
	if (seen.has(ref) || !Object.hasOwn(definitions, ref)) return undefined;
	seen.add(ref);
	return target(definitions[ref], definitions, seen);
}

function indices(node: Node, rules: readonly ('defaultWhen' | 'selectWhen')[]): number[] {
	const listed = rules.flatMap((name) => {
		const list = node[name];
		return Array.isArray(list) ? list.map((rule) => (isRecord(rule) ? rule['variant'] : undefined)) : [];
	});
	return [...listed, node['defaultVariant']].filter((index): index is number => typeof index === 'number');
}

/**
 * The unions a union may continue with for the same value: the members its `selectWhen` rules, its
 * `defaultWhen` rules or its `defaultVariant` choose, and the defaults of the unions nested in it
 * (`defaultOf` falls back to them), where the chosen member is a union again.
 */
function chosenUnions(union: Node, definitions: Definitions): Node[] {
	const found: Node[] = [];
	const visit = (node: Node, rules: readonly ('defaultWhen' | 'selectWhen')[], seen: Set<Node>): void => {
		seen.add(node);
		const members = membersOf(node);
		for (const index of indices(node, rules)) {
			const chosen = target(members[index], definitions);
			if (chosen?.['kind'] === 'union') found.push(chosen);
		}
		for (const member of members) {
			const nested = target(member, definitions);
			if (nested?.['kind'] === 'union' && !seen.has(nested)) visit(nested, ['defaultWhen'], seen);
		}
	};
	visit(union, ['selectWhen', 'defaultWhen'], new Set());
	return found;
}

/**
 * The definitions whose union chooses, for one value, a member that leads back to the union: the
 * walk would select it again without end (H6). Each is named once.
 */
export function loopingDefaults(definitions: Definitions): readonly string[] {
	const looping: string[] = [];
	for (const [name, node] of Object.entries(definitions)) {
		const start = target(node, definitions);
		if (start?.['kind'] !== 'union') continue;
		const seen = new Set<Node>();
		const pending = chosenUnions(start, definitions);
		for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
			if (next === start) {
				looping.push(name);
				break;
			}
			if (seen.has(next)) continue;
			seen.add(next);
			pending.push(...chosenUnions(next, definitions));
		}
	}
	return looping;
}
