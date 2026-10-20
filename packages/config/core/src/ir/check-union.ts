import { isRecord } from '@chartguard/core';

import { DEFAULT_TESTS } from '../schema.js';

const TEST_SET: ReadonlySet<unknown> = new Set(DEFAULT_TESTS);
export const LITERAL_TYPES: ReadonlySet<string> = new Set(['string', 'number', 'boolean']);

type Node = Record<string, unknown>;

/** Where the union checks report: the artifact checker. */
export interface Reporter {
	report(path: string, message: string): void;
}

function isIndexBelow(value: unknown, size: number): boolean {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < size;
}

function isDefaultRule(rule: unknown, size: number): boolean {
	if (!isRecord(rule)) return false;
	const { test, property, variant } = rule;
	return TEST_SET.has(test) && typeof property === 'string' && property !== '' && isIndexBelow(variant, size);
}

function checkDefaultWhen(checker: Reporter, rules: unknown, path: string, size: number): void {
	if (rules === undefined) return;
	if (!Array.isArray(rules) || !rules.every((rule) => isDefaultRule(rule, size)))
		checker.report(
			path,
			`defaultWhen must be a list of { test: ${DEFAULT_TESTS.join(' | ')}, property: <name>, variant: <anyOf index> }`
		);
}

export const isNonEmpty = (value: unknown): boolean => typeof value === 'string' && value !== '';

/** A path from the root and a literal fallback; it names a variant, so the union needs a discriminator. */
function checkDefaultFrom(checker: Reporter, node: Node, path: string): void {
	const from = node['defaultFrom'];
	if (from === undefined) return;
	const steps = isRecord(from) ? from['path'] : undefined;
	const fallback = isRecord(from) ? from['fallback'] : undefined;
	const wellFormed =
		Array.isArray(steps) && steps.length > 0 && steps.every(isNonEmpty) && LITERAL_TYPES.has(typeof fallback);
	if (!wellFormed)
		checker.report(path, 'defaultFrom must be { path: <non-empty property names>, fallback: <literal> }');
	else if (typeof node['discriminator'] !== 'string') checker.report(path, 'defaultFrom needs a discriminator');
}

/** A registry names where the runtime looks the discriminator up, so the union needs both, and must be extensible. */
function checkRegistry(checker: Reporter, node: Node, path: string): void {
	const { registry } = node;
	if (registry === undefined) return;
	const wellFormed =
		isRecord(registry) &&
		typeof registry['id'] === 'string' &&
		registry['id'] !== '' &&
		typeof registry['prefix'] === 'string' &&
		typeof registry['enforced'] === 'boolean';
	if (!wellFormed)
		checker.report(path, 'registry must be { id: <non-empty string>, prefix: <string>, enforced: <boolean> }');
	else if (typeof node['discriminator'] !== 'string' || node['extensible'] !== true)
		checker.report(path, 'a registry needs a discriminator and extensible: true');
}

/** A union that takes variant extensions names its point; it needs a registry, whose registration still applies. */
function checkVariantPoint(checker: Reporter, node: Node, path: string): void {
	const { extensionPoint, registry } = node;
	if (extensionPoint === undefined) return;
	if (!isRecord(registry) || typeof extensionPoint !== 'string' || extensionPoint === '')
		checker.report(path, 'a union extensionPoint must be a non-empty string on a union with a registry');
}

export function checkUnionOptions(checker: Reporter, node: Node, path: string, size: number): void {
	const { defaultVariant, extensible, discriminator } = node;
	if (defaultVariant !== undefined && !isIndexBelow(defaultVariant, size))
		checker.report(path, 'defaultVariant must index anyOf');
	checkDefaultWhen(checker, node['defaultWhen'], path, size);
	checkDefaultFrom(checker, node, path);
	if (extensible !== undefined && typeof extensible !== 'boolean') checker.report(path, 'extensible must be a boolean');
	checkRegistry(checker, node, path);
	checkVariantPoint(checker, node, path);
	if (discriminator !== undefined && typeof discriminator !== 'string')
		checker.report(path, 'discriminator must be a string');
}
