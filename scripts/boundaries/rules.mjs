import { isBuiltin } from 'node:module';
import { relative, resolve } from 'node:path';

import { chartRuntimeOf } from './policy.mjs';

const INTERNAL_SCOPE = '@chartguard/';

function matches(allowed, name) {
	return allowed.some((entry) => (typeof entry === 'string' ? entry === name : entry.test(name)));
}

function packageNameOf(specifier) {
	const segments = specifier.split('/');
	return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}

function runtimeMessage(name) {
	return `pulls in the ${chartRuntimeOf(name)} chart runtime "${name}"`;
}

function checkDependency(name, section, rule) {
	if (name.startsWith(INTERNAL_SCOPE))
		return rule.internal.includes(name) ? undefined : `must not depend on ${name} (${section})`;
	const allowed = section === 'peerDependencies' ? rule.peer : rule.external;
	if (matches(allowed, name)) return undefined;
	return chartRuntimeOf(name) === undefined
		? `must not depend on external package ${name} (${section})`
		: `${runtimeMessage(name)} (${section})`;
}

const SECTIONS = ['dependencies', 'optionalDependencies', 'peerDependencies'];

export function declaredDependencies(manifest) {
	return new Set(SECTIONS.flatMap((section) => Object.keys(manifest[section] ?? {})));
}

/** Policy violations in a package.json; an unlisted package is itself a violation. */
export function checkManifest(manifest, policy) {
	const rule = policy[manifest.name];
	if (rule === undefined) return [`${manifest.name} has no entry in the boundary policy`];
	return SECTIONS.flatMap((section) =>
		Object.keys(manifest[section] ?? {}).map((name) => checkDependency(name, section, rule))
	).filter((message) => message !== undefined);
}

function checkRelative({ packageDir, file, specifier }) {
	const target = relative(packageDir, resolve(file, '..', specifier));
	return target.startsWith('..') ? `relative import "${specifier}" escapes the package` : undefined;
}

function checkBuiltin(specifier, rule) {
	return rule.node ? undefined : `must not import Node.js built-in "${specifier}"`;
}

function checkPackageImport(specifier, rule, declared) {
	const name = packageNameOf(specifier);
	if (name.startsWith(INTERNAL_SCOPE) && name !== specifier)
		return `deep import "${specifier}"; import the package entry point`;
	if (!declared.has(name))
		return chartRuntimeOf(name) === undefined ? `imports undeclared package ${name}` : runtimeMessage(name);
	return undefined;
}

/** Policy violation for one module reference in a source file, if any. */
export function checkImport({ rule, declared, packageDir, file, specifier }) {
	if (specifier === undefined) return 'computed module specifier cannot be verified statically';
	if (specifier.startsWith('.')) return checkRelative({ packageDir, file, specifier });
	if (isBuiltin(specifier)) return checkBuiltin(specifier, rule);
	return checkPackageImport(specifier, rule, declared);
}
