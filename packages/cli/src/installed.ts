import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { InputError } from './errors.js';
import type { Library } from './libraries.js';

/** The npm package each library is installed as. */
const PACKAGES: Readonly<Record<Library, string>> = {
	chartjs: 'chart.js',
	echarts: 'echarts',
	highcharts: 'highcharts'
};

async function versionAt(manifestPath: string): Promise<string | undefined> {
	try {
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version?: unknown };
		return typeof manifest.version === 'string' ? manifest.version : undefined;
	} catch {
		return undefined;
	}
}

/** Where a library is installed for a project: its version, and the directory holding that `node_modules`. */
export interface Install {
	readonly version: string;
	readonly root: string;
}

/**
 * The install of `library` for the project that contains `file`, found the way Node resolves
 * packages: `node_modules/<package>/package.json` in the file's directory and upwards. Nothing is
 * executed or imported.
 */
export async function findInstall(library: Library, file: string): Promise<Install | undefined> {
	const packageName = PACKAGES[library];
	for (let directory = dirname(resolve(file)); ; directory = dirname(directory)) {
		const version = await versionAt(join(directory, 'node_modules', packageName, 'package.json'));
		if (version !== undefined) return { version, root: directory };
		if (dirname(directory) === directory) return undefined;
	}
}

/** The version of `library` installed for the project that contains `file`. */
export async function installedVersion(library: Library, file: string): Promise<string> {
	const install = await findInstall(library, file);
	if (install !== undefined) return install.version;
	throw new InputError(
		`${PACKAGES[library]} is not installed for ${dirname(resolve(file))}; pass --library-version <version>.`
	);
}
