import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { ChartLibrary } from '@chartguard/analysis-typescript';
import { localSchemaPath } from '@chartguard/schema-generator/paths';

/**
 * What the project of a linted file installs (CG-06-03 part 2): the only module of the plugin that
 * reads the disk (the plugin runs where ESLint runs, in Node). Found the way Node resolves packages, `node_modules/<package>/package.json` in the
 * file's directory and upwards; nothing is imported or run.
 */
const PACKAGES: Readonly<Record<ChartLibrary, string>> = {
	chartjs: 'chart.js',
	echarts: 'echarts',
	highcharts: 'highcharts'
};

/** Where a library is installed for a file: its version, and the directory that holds that `node_modules`. */
export interface Install {
	readonly version: string;
	readonly root: string;
}

function versionAt(manifestPath: string): string | undefined {
	try {
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown };
		return typeof manifest.version === 'string' ? manifest.version : undefined;
	} catch {
		return undefined;
	}
}

/** The install of `library` for the file `fileName` (relative names against the working directory). */
export function findInstall(library: ChartLibrary, fileName: string): Install | undefined {
	for (let directory = dirname(resolve(fileName)); ; directory = dirname(directory)) {
		const version = versionAt(join(directory, 'node_modules', PACKAGES[library], 'package.json'));
		if (version !== undefined) return { version, root: directory };
		if (dirname(directory) === directory) return undefined;
	}
}

/** Why `"auto"` cannot name a version for `fileName`: the library is not installed for its directory. */
export const notInstalled = (library: ChartLibrary, fileName: string): string =>
	`${PACKAGES[library]} is not installed for ${dirname(resolve(fileName))}`;

/** A schema built from the install (`chartguard schema build`), with what identifies its content on disk. */
export interface BuiltSchema {
	readonly path: string;
	readonly stamp: string;
	readonly read: () => string;
}

/** The schema built for exactly the installed version, if there is one; a schema for another version is never used. */
export function builtSchema(library: ChartLibrary, install: Install): BuiltSchema | undefined {
	const path = localSchemaPath(install.root, library, install.version);
	try {
		const { size, mtimeMs } = statSync(path);
		return { path, stamp: `${String(size)}:${String(mtimeMs)}`, read: () => readFileSync(path, 'utf8') };
	} catch {
		return undefined;
	}
}
