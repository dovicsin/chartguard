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

/**
 * The version of `library` installed for the project that contains `file`, found the way Node
 * resolves packages: `node_modules/<package>/package.json` in the file's directory and upwards.
 * Nothing is executed or imported.
 */
export async function installedVersion(library: Library, file: string): Promise<string> {
	const packageName = PACKAGES[library];
	const start = dirname(resolve(file));
	for (let directory = start; ; directory = dirname(directory)) {
		const version = await versionAt(join(directory, 'node_modules', packageName, 'package.json'));
		if (version !== undefined) return version;
		if (dirname(directory) === directory) break;
	}
	throw new InputError(`${packageName} is not installed for ${start}; pass --library-version <version>.`);
}
