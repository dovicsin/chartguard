import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { runAsEntryPoint } from '../../shared/entry.mjs';
import { corpusFile } from '../lib/corpus.mjs';
import { SOURCES } from './sources.mjs';

/**
 * Downloads a pinned example corpus and writes it where `corpusFile` says: next to this file, or
 * to the local cache when its license does not clear redistribution (Highcharts).
 * Run when a pin changes, and once per checkout for a local corpus:
 * `node tools/conformance/corpus/import.mjs highcharts`.
 * Nothing downloaded is executed here; the conformance sandboxes run it in isolation.
 */
const RAW = 'https://raw.githubusercontent.com';
const API = 'https://api.github.com';

/** The hosts a GitHub token is sent to, over https only: never to another host. */
const GITHUB_HOSTS = new Set(['api.github.com', 'raw.githubusercontent.com']);

function headersFor(url, token) {
	const { protocol, host } = new URL(url);
	return token && protocol === 'https:' && GITHUB_HOSTS.has(host) ? { authorization: `Bearer ${token}` } : {};
}

/** Why GitHub refused a request, when its rate limit did: the limit is per IP without a token. */
function limitNote(response, token) {
	const limited =
		response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0');
	if (!limited) return '';
	return token
		? ": GitHub's rate limit for this token is reached; retry after its reset"
		: ": GitHub's rate limit for unauthenticated requests (shared by every hosted runner) is reached; set GITHUB_TOKEN";
}

/**
 * The body at `url`. `GITHUB_TOKEN`, when set (CI passes the workflow token), authenticates the
 * requests to GitHub, whose limit for unauthenticated ones is per IP address.
 */
export async function text(url, { token = process.env['GITHUB_TOKEN'], fetch: get = fetch } = {}) {
	const response = await get(url, { headers: headersFor(url, token) });
	if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}${limitNote(response, token)}`);
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
		if (code === undefined) continue;
		const page = source.page === undefined ? undefined : await raw(source.page(path));
		files.push({
			path,
			sha256: sha256(original),
			code,
			...(page === undefined ? {} : { page, pageSha256: sha256(page) })
		});
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
	const target = corpusFile(library);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, `${JSON.stringify(corpus, null, '\t')}\n`);
	process.stdout.write(`${String(corpus.files.length)} examples -> ${target}\n`);
}

await runAsEntryPoint(import.meta.url, main);
