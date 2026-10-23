import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { moduleReferences } from './imports.mjs';
import { checkImport, checkManifest, declaredDependencies, publicEntryPoints } from './rules.mjs';

/** Not shipped or not run by users: build output, dependencies, tests and build-time tooling. */
const SKIPPED_DIRECTORIES = new Set(['dist', 'node_modules', 'tests', 'scripts']);

function findPackageDirs(directory) {
	const entries = readdirSync(directory, { withFileTypes: true });
	const nested = entries
		.filter((entry) => entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name))
		.flatMap((entry) => findPackageDirs(join(directory, entry.name)));
	return entries.some((entry) => entry.name === 'package.json') ? [directory, ...nested] : nested;
}

const SOURCE_EXTENSIONS = ['.ts', '.mts', '.mjs', '.js'];

const isSource = (name) => SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension)) && !/\.d\.m?ts$/.test(name);

/**
 * Every source file a package publishes or runs, wherever it lives (`src/`, `bin/`, a JavaScript
 * package's `lib/`): not only `src/**\/*.ts`, which let `.mjs` sources pass unchecked.
 */
function findSources(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) ? [] : findSources(path);
		return isSource(entry.name) ? [path] : [];
	});
}

function sourceViolations(packageDir, manifest, rule, entryPoints) {
	const declared = declaredDependencies(manifest);
	return findSources(packageDir).flatMap((file) =>
		moduleReferences(readFileSync(file, 'utf8'), file).flatMap(({ specifier, line }) => {
			const message = checkImport({ rule, declared, packageDir, file, specifier, entryPoints });
			return message === undefined ? [] : [{ file, line, message }];
		})
	);
}

const manifestOf = (packageDir) => JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));

function packageViolations(packageDir, policy, entryPoints) {
	const manifest = manifestOf(packageDir);
	const file = join(packageDir, 'package.json');
	const manifestViolations = checkManifest(manifest, policy).map((message) => ({ file, line: 1, message }));
	const rule = policy[manifest.name];
	const sources = rule === undefined ? [] : sourceViolations(packageDir, manifest, rule, entryPoints);
	return [...manifestViolations, ...sources].map((violation) => ({ ...violation, packageName: manifest.name }));
}

/** All boundary violations below `<root>/packages` and `<root>/apps`, with paths relative to root. */
/**
 * The package directories of the workspace at `root`. None is our defect (a wrong root), never a
 * workspace that respects every boundary (H11).
 */
export function workspacePackages(root) {
	const packageDirs = ['packages', 'apps']
		.map((directory) => join(root, directory))
		.filter((directory) => existsSync(directory))
		.flatMap((directory) => findPackageDirs(directory));
	if (packageDirs.length === 0) throw new Error(`no workspace packages under ${root}`);
	return packageDirs;
}

export function checkWorkspace(root, policy) {
	const packageDirs = workspacePackages(root);
	const entryPoints = publicEntryPoints(packageDirs.map(manifestOf));
	return packageDirs
		.flatMap((packageDir) => packageViolations(packageDir, policy, entryPoints))
		.map((violation) => ({ ...violation, file: relative(root, violation.file) }));
}
