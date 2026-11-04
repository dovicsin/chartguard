import { isRecord } from '@chartguard/core';

import { SKIPPED_KINDS } from './ir/types.js';
import { DEFAULT_TESTS } from './schema.js';

/**
 * Whether a schema someone wrote (a plugin's, CG-02-05) has the engine's shape all the way down, and
 * where it does not (C6): read before the schema is used, so a malformed node is a setup problem,
 * never a raw exception during a walk and never a confident finding made from a malformed schema.
 * Bounded: a schema may refer to itself (a recursive option), each node is read once, and the depth
 * and the number of nodes read are limited.
 */
/** How deep a schema someone wrote is read; a deeper one is refused (`schemaProblems`). */
export const MAX_SCHEMA_DEPTH = 256;
/** How many nodes of a schema someone wrote are read; a larger one is refused (`schemaProblems`). */
export const MAX_SCHEMA_NODES = 100_000;

const KINDS = ['object', 'array', 'string', 'number', 'boolean', 'null', 'function', 'union', 'any'];
const ADDITIONAL = ['allow', 'warn', 'deny'];
const UNION_FIELDS = [
	'anyOf',
	'discriminator',
	'defaultVariant',
	'defaultWhen',
	'selectWhen',
	'defaultFrom',
	'extensible',
	'registry'
];
const FIELDS = new Set([
	'kind',
	'properties',
	'element',
	'required',
	'enum',
	'additionalProperties',
	'extensionPoint',
	'inferred',
	'nullAsAbsent',
	'host',
	'skips',
	'values',
	'handledBy',
	'deprecated',
	'doc',
	'onMismatch',
	...UNION_FIELDS
]);

type Node = Readonly<Record<string, unknown>>;

/** What one check has read: each node once, how many, and the limit it stopped at, if any. */
class State {
	readonly seen = new WeakSet();
	private nodes = 0;
	stopped: string | undefined;

	/** Counts a node read; false, and the reason kept, once there are too many. */
	count(at: string): boolean {
		this.nodes += 1;
		if (this.nodes <= MAX_SCHEMA_NODES) return true;
		this.stopped = `${at}: the schema has more than ${String(MAX_SCHEMA_NODES)} nodes`;
		return false;
	}

	/** False, and the reason kept, when `depth` is beyond the limit. */
	within(depth: number, at: string): boolean {
		if (depth <= MAX_SCHEMA_DEPTH) return true;
		this.stopped = `${at}: the schema is deeper than ${String(MAX_SCHEMA_DEPTH)} levels`;
		return false;
	}
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isStrings = (value: unknown): boolean => Array.isArray(value) && value.every(isString);
const isEnumValue = (value: unknown): boolean => ['string', 'number', 'boolean'].includes(typeof value);
const isIndex = (value: unknown, length: number): boolean =>
	Number.isInteger(value) && (value as number) >= 0 && (value as number) < length;
const hasShape = (value: unknown, fields: Readonly<Record<string, (field: unknown) => boolean>>): boolean =>
	isRecord(value) &&
	Object.keys(value).every((key) => Object.hasOwn(fields, key)) &&
	Object.entries(fields).every(([key, accepts]) => accepts(value[key]));
const optionalString = (value: unknown): boolean => value === undefined || isString(value);
const isBoolean = (value: unknown): boolean => typeof value === 'boolean';

/** The fields whose value is a plain value, each with what it must be. */
const SCALAR_FIELDS: readonly [string, (value: unknown, node: Node) => boolean, string][] = [
	['required', isStrings, 'required must be a list of property names'],
	[
		'enum',
		(value) => Array.isArray(value) && value.every(isEnumValue),
		'enum must be a list of strings, numbers and booleans'
	],
	[
		'additionalProperties',
		(value) => ADDITIONAL.includes(value as string),
		'additionalProperties must be one of allow, warn, deny'
	],
	['extensionPoint', isString, 'extensionPoint must be a string'],
	['inferred', (value) => value === true, 'inferred must be true'],
	['nullAsAbsent', isBoolean, 'nullAsAbsent must be a boolean'],
	['host', isString, 'host must be a string'],
	['doc', isString, 'doc must be a string'],
	['onMismatch', isString, 'onMismatch must be a string'],
	[
		'skips',
		(value) => Array.isArray(value) && value.every((kind) => SKIPPED_KINDS.has(kind as string)),
		'skips must be a list of null, falsy, truthy'
	],
	[
		'handledBy',
		(value) => hasShape(value, { id: isString, name: isString, enforced: isBoolean }),
		'handledBy must be { id: string, name: string, enforced: boolean }'
	],
	[
		'deprecated',
		(value) =>
			hasShape(value, {
				since: optionalString,
				replacement: optionalString,
				message: optionalString,
				renameTo: optionalString
			}),
		'deprecated must be { since?, replacement?, message?, renameTo? } of strings'
	],
	['discriminator', isString, 'discriminator must be a string'],
	['extensible', isBoolean, 'extensible must be a boolean'],
	[
		'registry',
		(value) => hasShape(value, { id: isString, prefix: isString, enforced: isBoolean }),
		'registry must be { id: string, prefix: string, enforced: boolean }'
	]
];

const memberCount = (node: Node): number => (Array.isArray(node['anyOf']) ? node['anyOf'].length : 0);

const choice = (node: Node) => (value: unknown) =>
	hasShape(value, {
		test: (test) => (DEFAULT_TESTS as readonly unknown[]).includes(test),
		property: isString,
		variant: (variant) => isIndex(variant, memberCount(node))
	});

/** The union's choices of a default: each must name an index of `anyOf`. */
function choiceProblems(node: Node, at: string): string[] {
	const range = `an index of anyOf (0..${String(Math.max(0, memberCount(node) - 1))})`;
	const problems: string[] = [];
	if (node['defaultVariant'] !== undefined && !isIndex(node['defaultVariant'], memberCount(node)))
		problems.push(`${at}: defaultVariant must be ${range}`);
	for (const field of ['defaultWhen', 'selectWhen']) {
		const list = node[field];
		if (list === undefined) continue;
		if (!Array.isArray(list)) problems.push(`${at}: ${field} must be a list`);
		else
			list.forEach((entry, index) => {
				if (!choice(node)(entry))
					problems.push(
						`${at}: ${field}[${String(index)}] must be { test: truthy | nonEmpty | positive, property: string, variant: an index of anyOf }`
					);
			});
	}
	const from = node['defaultFrom'];
	if (from !== undefined && !hasShape(from, { path: isStrings, fallback: isEnumValue }))
		problems.push(`${at}: defaultFrom must be { path: string[], fallback: string | number | boolean }`);
	return problems;
}

/** The node's own fields: none unknown, union fields only on a union, each plain value of its type. */
function fieldProblems(node: Node, at: string): string[] {
	const kind = node['kind'] as string;
	const problems = Object.keys(node)
		.filter((key) => !FIELDS.has(key))
		.map((key) => `${at}: unknown field "${key}"`);
	if (kind !== 'union')
		problems.push(
			...UNION_FIELDS.filter((key) => node[key] !== undefined).map(
				(key) => `${at}: ${key} belongs to a union, not a ${kind}`
			)
		);
	for (const [field, accepts, message] of SCALAR_FIELDS)
		if (node[field] !== undefined && !accepts(node[field], node)) problems.push(`${at}: ${message}`);
	if (kind === 'union') {
		const members = node['anyOf'];
		if (!Array.isArray(members) || members.length === 0)
			problems.push(`${at}: anyOf must be a non-empty list of schemas`);
		else problems.push(...choiceProblems(node, at));
	}
	return problems;
}

/** The schemas below a node, each with its path. */
function children(node: Node, at: string): [unknown, string][] {
	const below: [unknown, string][] = [];
	for (const field of ['element', 'values']) if (node[field] !== undefined) below.push([node[field], `${at}.${field}`]);
	const members = node['anyOf'];
	if (Array.isArray(members)) members.forEach((member, index) => below.push([member, `${at}.anyOf[${String(index)}]`]));
	const properties = node['properties'];
	if (isRecord(properties))
		for (const [name, schema] of Object.entries(properties)) below.push([schema, `${at}.properties.${name}`]);
	return below;
}

function visit(value: unknown, at: string, depth: number, state: State): string[] {
	if (state.stopped !== undefined || !state.within(depth, at)) return [];
	if (!isRecord(value) || !isString(value['kind'])) return [`${at}: not a schema (an object with a kind)`];
	if (state.seen.has(value)) return [];
	state.seen.add(value);
	if (!state.count(at)) return [];
	if (!KINDS.includes(value['kind'])) return [`${at}: kind "${value['kind']}" is not one of ${KINDS.join(', ')}`];
	const problems = fieldProblems(value, at);
	if (value['properties'] !== undefined && !isRecord(value['properties']))
		problems.push(`${at}: properties must be an object of schemas by name`);
	return [...problems, ...children(value, at).flatMap(([child, path]) => visit(child, path, depth + 1, state))];
}

/** Every problem with the shape of `schema` (named `at` in each), or none: then the engine can read it. */
export function schemaProblems(schema: unknown, at: string): string[] {
	const state = new State();
	const problems = visit(schema, at, 0, state);
	return state.stopped === undefined ? problems : [state.stopped];
}
