import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	generateArtifact,
	isRedistributable,
	LIBRARIES,
	LOCAL_ARTIFACTS,
	localSchemaPath,
	sourceDirectory,
	verifiedUpstream
} from '@chartguard/schema-generator';

import { runAsEntryPoint } from '../shared/entry.mjs';
import { noticesText, packageNotices } from '../shared/notices.mjs';

/**
 * The maintainer's entry point: regenerates the committed artifacts from this repository's pinned
 * installs (`write`) or verifies they are current (`check`). The generator itself is the
 * `@chartguard/schema-generator` package, which users run on their own installs.
 */
export { isRedistributable, LIBRARIES, LOCAL_ARTIFACTS };

/** The adapter package that ships each library's committed artifact. */
const ADAPTERS = {
	chartjs: 'packages/config/chartjs',
	echarts: 'packages/config/echarts',
	highcharts: 'packages/config/highcharts'
};
/** The repository root, independent of the directory the command is run from. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MODES = new Set(['write', 'check']);
/** Beside a committed artifact, the licence and notices of every package it is built from (CG-07-06). */
export const NOTICES = 'THIRD-PARTY-NOTICES.txt';
const EXIT_STALE = 1;
const EXIT_USAGE = 2;

/** Committed next to the adapter when the license allows it; otherwise local to this checkout. */
export function artifactPath(root, pin, library) {
	if (!isRedistributable(pin)) return localSchemaPath(root, library, pin.version);
	return join(root, ADAPTERS[library], 'src/generated', `${library}-${pin.version}.json`);
}

/** Deterministic artifact text for one library from this repository's pinned install. */
export function generate(root, library) {
	const pin = verifiedUpstream(root, library);
	return { path: artifactPath(root, pin, library), text: generateArtifact(root, library, pin).text };
}

/** The files one library's generation writes: its artifact and, when it ships, the notices beside it. */
export function outputs(root, library) {
	const artifact = generate(root, library);
	if (!isRedistributable(verifiedUpstream(root, library))) return [artifact];
	const entries = packageNotices(
		Object.values(JSON.parse(artifact.text).sources).map(({ locator }) =>
			sourceDirectory(root, locator.slice(0, locator.lastIndexOf('@')))
		)
	);
	return [artifact, { path: join(root, ADAPTERS[library], NOTICES), text: noticesText(entries) }];
}

function currentText(path) {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return '';
	}
}

/** Returns the stale artifact paths in check mode; writes them in write mode. */
export function run(mode, libraries) {
	const stale = [];
	for (const { path, text } of libraries.flatMap((library) => outputs(ROOT, library)))
		if (mode === 'check') {
			if (currentText(path) !== text) stale.push(path);
		} else {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, text);
		}
	return stale;
}

function usage(argv) {
	const [mode = 'write', ...libraries] = argv;
	const unknown = libraries.filter((library) => !LIBRARIES.includes(library));
	if (!MODES.has(mode)) return `Unknown mode "${mode}"; expected write or check.`;
	if (unknown.length > 0) return `No generator for: ${unknown.join(', ')}.`;
	return undefined;
}

function main(argv) {
	const problem = usage(argv);
	if (problem !== undefined) {
		process.stderr.write(`${problem}\nUsage: generate.mjs [write|check] [${LIBRARIES.join('|')}]...\n`);
		return EXIT_USAGE;
	}
	const [mode = 'write', ...libraries] = argv;
	const stale = run(mode, libraries.length > 0 ? libraries : LIBRARIES);
	for (const path of stale) process.stderr.write(`Stale generated file: ${path}; run npm run schema:generate\n`);
	return stale.length > 0 ? EXIT_STALE : 0;
}

await runAsEntryPoint(import.meta.url, main);
