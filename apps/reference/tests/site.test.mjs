import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import test, { after } from 'node:test';

import { REFERENCE_URL, referenceUrl } from '@chartguard/core';
import { RULE_CATALOG } from '@chartguard/quality-core';

import { codeFromText } from '../../../scripts/tests/browser-guards.mjs';
import { documentedExports, parseSurface, publishedEntryPoints } from '../../../tools/api/surface.mjs';
import { buildReference, ROOT } from '../scripts/build.mjs';
import { CODES } from '../scripts/codes.mjs';
import { emittedCodes } from '../scripts/emitted.mjs';
import { guideMarkdown, markdown } from '../scripts/html.mjs';
import { GUIDES } from '../scripts/pages.mjs';

/** The reference site (CG-06-07): built once from tracked sources, then read as a reader's browser would. */
const outdir = mkdtempSync(join(tmpdir(), 'reference-'));
after(() => rmSync(outdir, { recursive: true, force: true }));
const built = buildReference(outdir);

function pagesUnder(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return pagesUnder(path);
		return entry.name.endsWith('.html') ? [path] : [];
	});
}

const attributes = (html, name) =>
	[...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'gu'))].map(([, value]) => value);
const unescape = (text) => text.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");

test('the codes page documents exactly the CFG codes the packages emit, and the rules page every VIS code', async () => {
	await built;
	const emitted = emittedCodes(ROOT);
	const cfg = [...emitted.keys()].filter((code) => code.startsWith('CFG_'));
	assert.deepEqual(CODES.map(({ code }) => code).sort(), cfg);
	const vis = [...emitted.keys()].filter((code) => code.startsWith('VIS_'));
	assert.deepEqual(RULE_CATALOG.map(({ code }) => code).sort(), vis);
	assert.deepEqual(
		[...emitted.keys()].filter((code) => !code.startsWith('CFG_') && !code.startsWith('VIS_')),
		[]
	);
	const codes = readFileSync(join(outdir, 'codes.html'), 'utf8');
	const rules = readFileSync(join(outdir, 'rules.html'), 'utf8');
	for (const code of cfg) assert.match(codes, new RegExp(`id="${code}"`, 'u'), code);
	for (const code of vis) assert.match(rules, new RegExp(`id="${code}"`, 'u'), code);
});

test('every export of every recorded API surface has its entry, and every one says what it is', async () => {
	await built;
	const undocumented = [];
	for (const { specifier, types, packageName } of publishedEntryPoints(ROOT)) {
		const surface = parseSurface(
			readFileSync(
				join(ROOT, 'tools', 'api', 'surfaces', `${packageName.replace('@', '').replace('/', '__')}.api.md`),
				'utf8'
			)
		);
		const page = readFileSync(
			join(outdir, 'api', `${specifier.replace('@chartguard/', '').replaceAll('/', '-')}.html`),
			'utf8'
		);
		const anchors = new Set(attributes(page, 'id').map(unescape));
		for (const name of surface.get(specifier)?.keys() ?? []) assert.ok(anchors.has(name), `${specifier} ${name}`);
		undocumented.push(
			...documentedExports(types)
				.filter(({ doc }) => doc === '')
				.map(({ name }) => `${specifier} ${name}`)
		);
	}
	assert.deepEqual(undocumented, []);
	// The comment the declaration carries is what the page says, member comments in the declaration.
	const core = readFileSync(join(outdir, 'api', 'core.html'), 'utf8');
	assert.match(core, /<p>The config with <code>fix<\/code> applied/u);
	assert.match(core, /\/\*\*\s+\* `rename-key`: present only when applying it cannot change what the runtime does/u);
});

/** Whether a link of the page at `path` is broken: `anchors` holds every page's ids. */
function isBroken(path, href, anchors) {
	if (href.startsWith('https://')) return false;
	if (/^[a-z]+:/u.test(href)) return true;
	const [target, anchor = ''] = href.split('#');
	const file = target === '' ? path : resolve(dirname(path), target);
	// The playground is deployed one level up (`/` beside `/reference/`): its examples are its own to check.
	if (relative(outdir, file).split(sep)[0] === '..') return relative(outdir, file) !== '..';
	if (!existsSync(file)) return true;
	return anchor !== '' && anchors.get(file)?.has(decodeURIComponent(anchor)) !== true;
}

test('every link of the site leads to a page and anchor it has, to the web over https, or to the playground beside it', async () => {
	await built;
	const pages = pagesUnder(outdir);
	const anchors = new Map(
		pages.map((path) => [path, new Set(attributes(readFileSync(path, 'utf8'), 'id').map(unescape))])
	);
	const broken = pages.flatMap((path) =>
		attributes(readFileSync(path, 'utf8'), 'href')
			.map(unescape)
			.filter((href) => isBroken(path, href, anchors))
			.map((href) => `${relative(outdir, path)} → ${href}`)
	);
	assert.deepEqual(broken, []);
});

test('the link check catches a missing page, a missing anchor and a link above the playground', async () => {
	await built;
	const codes = join(outdir, 'codes.html');
	const anchors = new Map([[codes, new Set(['CFG_TYPE'])]]);
	for (const href of ['missing.html', '#NOPE', 'codes.html#NOPE', '../../elsewhere/', 'http://example.com'])
		assert.equal(isBroken(codes, href, anchors), true, href);
	for (const href of [
		'#CFG_TYPE',
		'codes.html#CFG_TYPE',
		'../#chartjs%3Avalid%3Abar',
		'https://example.com',
		'styles.css'
	])
		assert.equal(isBroken(codes, href, anchors), false, href);
});

test('the search index holds every code, rule, export and package, each at a page of the site', async () => {
	const site = await built;
	const index = JSON.parse(readFileSync(join(outdir, 'search-index.json'), 'utf8'));
	const titles = new Set(index.map(({ title }) => title));
	for (const { code } of [...CODES, ...RULE_CATALOG]) assert.ok(titles.has(code), code);
	for (const { exports } of site.apis) for (const { name } of exports) assert.ok(titles.has(name), name);
	for (const { name } of site.packages) assert.ok(titles.has(name), name);
	for (const { url } of index) assert.ok(existsSync(join(outdir, url.split('#')[0] ?? '')), url);
});

test('Markdown is shown, never run: raw HTML escaped, links only to the web or an anchor', () => {
	const html = markdown.parse(
		'<script>alert(1)</script>\n\nText <img src=x onerror=alert(1)> [web](https://example.com) [file](../LICENSE) [here](#a)\n\n![logo](x.png)'
	);
	assert.doesNotMatch(html, /<script|<img|onerror="/u);
	assert.match(html, /&lt;script&gt;/u);
	assert.match(html, /<a href="https:\/\/example\.com">web<\/a>/u);
	assert.match(html, /<a href="#a">here<\/a>/u);
	assert.doesNotMatch(html, /href="\.\.\/LICENSE"/u);
	assert.match(markdown.parse('## A heading'), /<h2 id="a-heading">/u);
});

test('the browser script makes no code or markup from text, and every page allows scripts from the site only', async () => {
	await built;
	assert.deepEqual(codeFromText([{ path: 'search.js', text: readFileSync(join(outdir, 'search.js'), 'utf8') }]), []);
	for (const path of pagesUnder(outdir)) {
		const html = readFileSync(path, 'utf8');
		assert.match(html, /script-src 'self';/u, path);
		assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)/u, path);
	}
});

test('every code a package emits has the anchor its findings link to, on the site the Pages workflow deploys (CG-06-07)', async () => {
	await built;
	const anchors = new Set(attributes(readFileSync(join(outdir, 'codes.html'), 'utf8'), 'id').map(unescape));
	const codes = [...emittedCodes(ROOT).keys(), ...RULE_CATALOG.map(({ code }) => code)];
	const missing = codes.filter((code) => {
		const url = new URL(referenceUrl(code));
		return url.href !== `${REFERENCE_URL}codes.html${url.hash}` || !anchors.has(decodeURIComponent(url.hash.slice(1)));
	});
	assert.deepEqual(missing, []);
	// The reference is the repository's Pages site, at `/reference/`, where the workflow puts it.
	const repository = JSON.parse(readFileSync(join(ROOT, 'packages', 'core', 'package.json'), 'utf8')).repository.url;
	const [, owner, name] = /github\.com\/([\w-]+)\/([\w.-]+?)(?:\.git)?$/u.exec(repository) ?? [];
	assert.equal(REFERENCE_URL, `https://${owner}.github.io/${name}/reference/`);
	const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
	assert.match(workflow, /cp -R apps\/reference\/dist\/web site\/reference\n/u);
});

test('the guides are pages of the site: in the navigation, searchable, their site links kept, a README link still text', async () => {
	const site = await built;
	assert.deepEqual(
		site.guides.map(({ name }) => name),
		GUIDES
	);
	for (const name of GUIDES) {
		const html = readFileSync(join(outdir, 'guides', `${name}.html`), 'utf8');
		assert.match(html, /<h1 id="[\w-]+">/u, name);
		assert.match(html, /<a href="\.\.\/guides\/getting-started\.html">Guides<\/a>/u, name);
	}
	const start = readFileSync(join(outdir, 'guides', 'getting-started.html'), 'utf8');
	assert.match(start, /<a href="\.\.\/codes\.html">codes page<\/a>/u);
	const index = JSON.parse(readFileSync(join(outdir, 'search-index.json'), 'utf8'));
	assert.deepEqual(
		index.filter(({ kind }) => kind === 'guide').map(({ url }) => url),
		GUIDES.map((name) => `guides/${name}.html`)
	);
	// A guide's relative link is a page of the site; anything else stays text, as in a README.
	for (const href of ['../codes.html#CFG_TYPE', 'ci.html', '../../'])
		assert.match(guideMarkdown.parse(`[x](${href})`), /<a href=/u, href);
	for (const href of ['../README.md', 'javascript:alert(1)', '//example.com/a.html', '../../docs/x.md'])
		assert.doesNotMatch(guideMarkdown.parse(`[x](${href})`), /<a href=/u, href);
	assert.doesNotMatch(markdown.parse('[x](../codes.html)'), /<a href=/u);
});
