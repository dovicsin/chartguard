import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { moduleReferences } from './imports.mjs';
import { checkImport, checkManifest, declaredDependencies } from './rules.mjs';

const SKIPPED_DIRECTORIES = new Set(['dist', 'node_modules', 'tests']);

function findPackageDirs(directory) {
	const entries = readdirSync(directory, { withFileTypes: true });
	const nested = entries
		.filter((entry) => entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name))
		.flatMap((entry) => findPackageDirs(join(directory, entry.name)));
	return entries.some((entry) => entry.name === 'package.json') ? [directory, ...nested] : nested;
}

function findSources(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return findSources(path);
		return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path] : [];
	});
}

function sourceViolations(packageDir, manifest, rule) {
	const declared = declaredDependencies(manifest);
	return findSources(join(packageDir, 'src')).flatMap((file) =>
		moduleReferences(readFileSync(file, 'utf8'), file).flatMap(({ specifier, line }) => {
			const message = checkImport({ rule, declared, packageDir, file, specifier });
			return message === undefined ? [] : [{ file, line, message }];
		})
	);
}

function packageViolations(packageDir, policy) {
	const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
	const file = join(packageDir, 'package.json');
	const manifestViolations = checkManifest(manifest, policy).map((message) => ({ file, line: 1, message }));
	const rule = policy[manifest.name];
	const sources = rule === undefined ? [] : sourceViolations(packageDir, manifest, rule);
	return [...manifestViolations, ...sources].map((violation) => ({ ...violation, packageName: manifest.name }));
}

/** All boundary violations below `<root>/packages`, with paths relative to root. */
export function checkWorkspace(root, policy) {
	return findPackageDirs(join(root, 'packages'))
		.flatMap((packageDir) => packageViolations(packageDir, policy))
		.map((violation) => ({ ...violation, file: relative(root, violation.file) }));
}
