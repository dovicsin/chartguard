import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

import { runAsEntryPoint } from '../../../tools/shared/entry.mjs';
import { isJsonSafe } from '../dist/examples.js';

const APP = fileURLToPath(new URL('..', import.meta.url));
const ROOT = join(APP, '..', '..');
export const OUT = join(APP, 'dist', 'web');

/**
 * The runtime-verified fixtures each config package owns; the playground shows the JSON-safe ones.
 * The Highcharts contract pins findings of the locally generated schema, which the playground
 * validates with the curated subset instead: it may not bundle a Highcharts-derived schema (CG-01-05).
 */
const FIXTURES = [
	{ library: 'chartjs', contract: true },
	{ library: 'echarts', contract: true },
	{ library: 'highcharts', contract: false }
].map((entry) => ({ ...entry, directory: join(ROOT, 'packages', 'config', entry.library, 'tests', 'fixtures') }));

const slug = (text) =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

async function fixtureModule(directory, file) {
	return readdirSync(directory).includes(file) ? import(pathToFileURL(join(directory, file)).href) : {};
}

async function examplesOf({ library, contract: withContract, directory }) {
	const { KNOWN_VALID = {} } = await fixtureModule(directory, 'known-valid.mjs');
	const { RUNTIME_CONTRACT = [] } = withContract ? await fixtureModule(directory, 'runtime-contract.mjs') : {};
	// The rules over several options at once have their own table (CG-02-08).
	const { RULES_CONTRACT = [] } = withContract ? await fixtureModule(directory, 'rules-contract.mjs') : {};
	const { DEPRECATIONS_CONTRACT = [] } = withContract
		? await fixtureModule(directory, 'deprecations-contract.mjs')
		: {};
	const valid = Object.entries(KNOWN_VALID).map(([title, config]) => ({ title, group: 'valid', config }));
	const contract = [...RUNTIME_CONTRACT, ...RULES_CONTRACT, ...DEPRECATIONS_CONTRACT].map(
		({ name, config, findings, runtime, why }) => ({
			title: name,
			group: 'contract',
			config,
			expected: { findings, runtime, ...(why === undefined ? {} : { why }) }
		})
	);
	return [...valid, ...contract]
		.filter(({ config }) => isJsonSafe(config))
		.map((example) => ({ id: `${library}:${example.group}:${slug(example.title)}`, library, ...example }));
}

export async function collectExamples() {
	return (await Promise.all(FIXTURES.map(examplesOf))).flat();
}

/**
 * esbuild options shared by the one-off build and the dev server: ESM with one lazily loaded chunk
 * per library. `NODE_ENV` is pinned to development: both runtimes report misuse (ECharts "Heatmap
 * must use with visualMap", Chart.js warnings) only in development builds, and esbuild would
 * otherwise default a minified browser build to production, hiding the runtime verdict the page
 * exists to show and diverging from tools/conformance.
 */
export function bundleOptions(outdir) {
	return {
		define: { 'process.env.NODE_ENV': '"development"' },
		entryPoints: { main: join(APP, 'src', 'main.ts') },
		bundle: true,
		splitting: true,
		format: 'esm',
		target: 'es2022',
		platform: 'browser',
		outdir,
		chunkNames: 'chunks/[name]-[hash]',
		minify: true,
		sourcemap: 'linked',
		metafile: true,
		logLevel: 'warning'
	};
}

/** Writes the static files and examples.json into `outdir`. */
export async function prepare(outdir) {
	rmSync(outdir, { recursive: true, force: true });
	mkdirSync(outdir, { recursive: true });
	cpSync(join(APP, 'static'), outdir, { recursive: true });
	writeFileSync(join(outdir, 'examples.json'), JSON.stringify(await collectExamples()));
}

export async function buildPlayground(outdir = OUT) {
	await prepare(outdir);
	const { metafile } = await build(bundleOptions(outdir));
	return metafile;
}

await runAsEntryPoint(import.meta.url, async () => {
	await buildPlayground();
});
