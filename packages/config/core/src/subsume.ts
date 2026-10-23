import type { AdditionalProperties, NodeSchema } from './schema.js';

/** How many node pairs one subsumption check may compare before it gives up (and claims nothing). */
const MAX_STEPS = 20_000;

const OPENNESS: Readonly<Record<AdditionalProperties, number>> = { deny: 0, warn: 1, allow: 2 };

/**
 * One subsumption check: its budget, and the pairs assumed to hold while they are compared (recursive
 * schemas), with the order they were assumed in, so that a comparison that fails takes back every
 * assumption made under it.
 */
class Run {
	readonly assumed = new Map<NodeSchema, Set<NodeSchema>>();
	readonly log: [NodeSchema, NodeSchema][] = [];
	private steps = 0;

	/** Counts one comparison; false once the budget is spent. */
	spend(): boolean {
		this.steps += 1;
		return this.steps <= MAX_STEPS;
	}
}

function assume(run: Run, wide: NodeSchema, narrow: NodeSchema): void {
	const set = run.assumed.get(wide) ?? new Set<NodeSchema>();
	set.add(narrow);
	run.assumed.set(wide, set);
	run.log.push([wide, narrow]);
}

/** Takes back every assumption made since the log had `length` entries. */
function rollback(run: Run, length: number): void {
	for (const [wide, narrow] of run.log.splice(length)) run.assumed.get(wide)?.delete(narrow);
}

const membersOf = (schema: NodeSchema): readonly NodeSchema[] => schema.anyOf ?? [];

function primitiveAccepts(wide: NodeSchema, narrow: NodeSchema): boolean {
	if (wide.enum === undefined) return true;
	return narrow.enum?.every((value) => wide.enum?.includes(value) === true) === true;
}

const openness = (schema: NodeSchema): number => OPENNESS[schema.additionalProperties ?? 'allow'];

/** Record values: both have them and the wide ones accept the narrow ones, or neither has them. */
function valuesAccept(wide: NodeSchema, narrow: NodeSchema, run: Run): boolean {
	if (wide.values === undefined || narrow.values === undefined) return wide.values === narrow.values;
	return accepts(wide.values, narrow.values, run);
}

/** The object facets besides its properties: platform class, record values, `null`, unknown keys, required keys. */
function shellAccepts(wide: NodeSchema, narrow: NodeSchema, run: Run): boolean {
	if (wide.host !== narrow.host || !valuesAccept(wide, narrow, run)) return false;
	if (narrow.nullAsAbsent === true && wide.nullAsAbsent !== true) return false;
	if (openness(wide) < openness(narrow)) return false;
	const required = new Set(narrow.required ?? []);
	return (wide.required ?? []).every((key) => required.has(key));
}

function objectAccepts(wide: NodeSchema, narrow: NodeSchema, run: Run): boolean {
	if (!shellAccepts(wide, narrow, run)) return false;
	const [wideProperties, narrowProperties] = [wide.properties ?? {}, narrow.properties ?? {}];
	for (const [key, schema] of Object.entries(narrowProperties)) {
		const other = Object.hasOwn(wideProperties, key) ? wideProperties[key] : undefined;
		if (other === undefined || !accepts(other, schema, run)) return false;
	}
	// A key only the wide member declares restricts a value the narrow one takes as an unknown key, unless it rejects those.
	return Object.keys(wideProperties).every(
		(key) => Object.hasOwn(narrowProperties, key) || narrow.additionalProperties === 'deny'
	);
}

function sameKindAccepts(wide: NodeSchema, narrow: NodeSchema, run: Run): boolean {
	if (wide.kind !== narrow.kind) return false;
	if (wide.kind === 'array') return accepts(wide.element ?? { kind: 'any' }, narrow.element ?? { kind: 'any' }, run);
	if (wide.kind === 'object') return objectAccepts(wide, narrow, run);
	return wide.kind === 'function' || primitiveAccepts(wide, narrow);
}

/**
 * Whether `wide` accepts every value `narrow` accepts, decided from the schemas alone and only when
 * that is certain: anything unsure (a facet not compared, the budget spent) is `false`. A finding on
 * a fact that is not authoritative is weaker, so a wide member may not be stronger than the narrow one.
 * Recursive schemas are compared coinductively: a pair under comparison is assumed to hold.
 */
function accepts(wide: NodeSchema, narrow: NodeSchema, run: Run): boolean {
	if (wide === narrow || wide.kind === 'any') return true;
	if (!run.spend()) return false;
	if (narrow.inferred === true && wide.inferred !== true) return false;
	if (run.assumed.get(wide)?.has(narrow) === true) return true;
	const mark = run.log.length;
	assume(run, wide, narrow);
	const holds = compare(wide, narrow, run);
	if (!holds) rollback(run, mark);
	return holds;
}

function compare(wide: NodeSchema, narrow: NodeSchema, run: Run): boolean {
	if (narrow.kind === 'union') return membersOf(narrow).every((member) => accepts(wide, member, run));
	if (wide.kind === 'union') return membersOf(wide).some((member) => accepts(member, narrow, run));
	return sameKindAccepts(wide, narrow, run);
}

/**
 * The member that accepts everything each of the others accepts, when there is one: the union of
 * them all accepts exactly what it does (a Chart.js scriptable copy of an options object subsumes the
 * plain one). Undefined when none does: the members are then told apart some other way, or not at all.
 */
export function subsumingMember(members: readonly NodeSchema[]): NodeSchema | undefined {
	const run = new Run();
	return members.find((wide) =>
		members.every((narrow) => {
			const mark = run.log.length;
			const holds = narrow === wide || accepts(wide, narrow, run);
			// Assumptions are only valid inside one top-level comparison.
			rollback(run, mark);
			return holds;
		})
	);
}
