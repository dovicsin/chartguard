import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAsEntryPoint } from '../shared/entry.mjs';
import { generateChartjs } from './lib/chartjs.mjs';
import { serialize,withDigest } from './lib/digest.mjs';
import { generateEcharts } from './lib/echarts.mjs';
import { verifiedUpstream } from './lib/lock.mjs';

const GENERATORS = {
	chartjs: { package: 'packages/config/chartjs', generate: generateChartjs },
	echarts: { package: 'packages/config/echarts', generate: generateEcharts }
};
/** The repository root, independent of the directory the command is run from. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MODES = new Set(['write', 'check']);
const EXIT_STALE = 1;
const EXIT_USAGE = 2;

export function artifactPath(root, library, version) {
	return join(root, GENERATORS[library].package, 'src/generated', `${library}-${version}.json`);
}

/** Deterministic artifact text for one library, carrying the digest of its own content. */
export function generate(root, library) {
	const pin = verifiedUpstream(root, library);
	const artifact = withDigest(GENERATORS[library].generate(root, pin));
	return { path: artifactPath(root, library, pin.version), text: serialize(artifact) };
}

export const LIBRARIES = Object.keys(GENERATORS);

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
	for (const library of libraries) {
		const { path, text } = generate(ROOT, library);
		if (mode === 'check') {
			if (currentText(path) !== text) stale.push(path);
		} else {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, text);
		}
	}
	return stale;
}

function usage(argv) {
	const [mode = 'write', ...libraries] = argv;
	const unknown = libraries.filter((library) => !Object.hasOwn(GENERATORS, library));
	if (!MODES.has(mode)) return `Unknown mode "${mode}"; expected write or check.`;
	if (unknown.length > 0) return `No generator for: ${unknown.join(', ')}.`;
	return undefined;
}

function main(argv) {
	const problem = usage(argv);
	if (problem !== undefined) {
		process.stderr.write(`${problem}\nUsage: generate.mjs [write|check] [${Object.keys(GENERATORS).join('|')}]...\n`);
		return EXIT_USAGE;
	}
	const [mode = 'write', ...libraries] = argv;
	const stale = run(mode, libraries.length > 0 ? libraries : Object.keys(GENERATORS));
	for (const path of stale) process.stderr.write(`Stale schema artifact: ${path}; run npm run schema:generate\n`);
	return stale.length > 0 ? EXIT_STALE : 0;
}

await runAsEntryPoint(import.meta.url, main);
