import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RULE_CATALOG } from '@chartguard/quality-core';

import { documentedExports, publishedEntryPoints } from '../../../tools/api/surface.mjs';
import { runAsEntryPoint } from '../../../tools/shared/entry.mjs';
import { manifestsUnder } from '../../../tools/shared/workspace.mjs';
import { collectExamples } from '../../playground/scripts/build.mjs';
import { CODES, GROUPS } from './codes.mjs';
import { emittedCodes } from './emitted.mjs';
import { apiIndex, apiPage, codesPage, indexPage, packagePage, pageName, rulesPage, searchPage } from './pages.mjs';
import { searchIndex } from './search.mjs';

const APP = fileURLToPath(new URL('..', import.meta.url));
export const ROOT = join(APP, '..', '..');
export const OUT = join(APP, 'dist', 'web');

/** Code-point order, never the locale's (D12). */
const byCodePoint = (a, b) => (a < b ? -1 : Number(a > b));

/** Every package with a README: published ones and the editor packages not published yet. */
function packagesOf(entryPoints) {
	return manifestsUnder(join(ROOT, 'packages'))
		.filter(({ path }) => existsSync(join(path, 'README.md')))
		.map(({ path, manifest }) => ({
			name: manifest.name,
			description: manifest.description ?? '',
			published: manifest.private !== true,
			readme: readFileSync(join(path, 'README.md'), 'utf8'),
			entries: entryPoints.filter(({ packageName }) => packageName === manifest.name).map(({ specifier }) => specifier)
		}))
		.sort((a, b) => byCodePoint(a.name, b.name));
}

/** For each code a contract example pins, the examples (`severity CODE path` findings), in their order. */
function examplesByCode(examples) {
	const byCode = new Map();
	for (const { id, title, expected } of examples)
		for (const finding of expected?.findings ?? []) {
			const code = finding.split(' ')[1] ?? '';
			const list = byCode.get(code) ?? [];
			if (!list.some((example) => example.id === id)) list.push({ id, title });
			byCode.set(code, list);
		}
	return byCode;
}

/** Everything the site is made of, read from tracked sources only. */
export async function collect() {
	const entryPoints = publishedEntryPoints(ROOT);
	const apis = entryPoints.map(({ specifier, types }) => ({ specifier, exports: documentedExports(types) }));
	const emitted = emittedCodes(ROOT);
	const examples = examplesByCode(await collectExamples());
	const facts = new Map(
		CODES.map(({ code }) => [code, { packages: emitted.get(code) ?? [], examples: examples.get(code) ?? [] }])
	);
	return {
		readme: readFileSync(join(ROOT, 'README.md'), 'utf8'),
		packages: packagesOf(entryPoints),
		apis,
		emitted,
		facts,
		rules: RULE_CATALOG
	};
}

function write(outdir, path, text) {
	const file = join(outdir, path);
	mkdirSync(join(file, '..'), { recursive: true });
	writeFileSync(file, text);
}

/** Writes the site into `outdir`: every page, the search index, the styles and the search script. */
export async function buildReference(outdir = OUT) {
	const site = await collect();
	rmSync(outdir, { recursive: true, force: true });
	cpSync(join(APP, 'static'), outdir, { recursive: true });
	write(outdir, 'index.html', indexPage(site.readme, site.packages));
	for (const entry of site.packages) write(outdir, `packages/${pageName(entry.name)}.html`, packagePage(entry));
	for (const { specifier, exports } of site.apis)
		write(outdir, `api/${pageName(specifier)}.html`, apiPage(specifier, exports));
	write(
		outdir,
		'api/index.html',
		apiIndex(site.apis.map(({ specifier, exports }) => ({ specifier, count: exports.length })))
	);
	write(outdir, 'codes.html', codesPage(GROUPS, CODES, site.facts));
	write(outdir, 'rules.html', rulesPage(site.rules));
	write(outdir, 'search.html', searchPage());
	write(outdir, 'search-index.json', JSON.stringify(searchIndex(site)));
	return site;
}

await runAsEntryPoint(import.meta.url, async () => {
	await buildReference();
});
