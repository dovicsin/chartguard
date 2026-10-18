import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isEntryPoint } from '../../shared/entry.mjs';
import { SOURCES } from './sources.mjs';

/**
 * Downloads a pinned example corpus and writes it as `<library>.json` next to this file.
 * Run by hand when a pin changes: `node tools/conformance/corpus/import.mjs chartjs`.
 * Nothing downloaded is executed here; the conformance sandbox runs it in isolation.
 */
const RAW = 'https://raw.githubusercontent.com';
const API = 'https://api.github.com';

async function text(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`);
	return response.text();
}

async function treePaths({ repository, commit }) {
	const tree = JSON.parse(await text(`${API}/repos/${repository}/git/trees/${commit}?recursive=1`));
	if (tree.truncated) throw new Error(`${repository}@${commit}: tree listing truncated`);
	return tree.tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path);
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function importCorpus(library, retrieved) {
	const source = SOURCES[library];
	const raw = (path) => text(`${RAW}/${source.repository}/${source.commit}/${path}`);
	const paths = (await treePaths(source)).filter(source.select).sort();
	const files = [];
	for (const path of paths) {
		const original = await raw(path);
		const code = source.extract(original);
		if (code !== undefined) files.push({ path, sha256: sha256(original), code });
	}
	const notice = source.noticePath === undefined ? undefined : await raw(source.noticePath);
	return {
		library,
		source: {
			repository: source.repository,
			ref: source.ref,
			commit: source.commit,
			retrieved,
			license: source.license,
			licenseText: await raw(source.licensePath),
			...(notice === undefined ? {} : { notice })
		},
		files
	};
}

async function main([library, retrieved = new Date().toISOString().slice(0, 10)]) {
	if (!Object.hasOwn(SOURCES, library)) throw new Error(`Usage: import.mjs <${Object.keys(SOURCES).join('|')}> [date]`);
	const corpus = await importCorpus(library, retrieved);
	const target = fileURLToPath(new URL(`${library}.json`, import.meta.url));
	writeFileSync(target, `${JSON.stringify(corpus, null, '\t')}\n`);
	process.stdout.write(`${String(corpus.files.length)} examples -> ${target}\n`);
}

if (isEntryPoint(import.meta.url))
	await main(process.argv.slice(2));
