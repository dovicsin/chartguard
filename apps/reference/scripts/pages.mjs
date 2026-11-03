import { escape, markdown, page } from './html.mjs';

/** A package or entry point's page name: `@chartguard/analysis-typescript/project` → `analysis-typescript-project`. */
export const pageName = (specifier) => specifier.replace(/^@chartguard\//u, '').replaceAll('/', '-');

/** Where the playground is, relative to the site's root (the site is deployed at `/reference/` beside it). */
const PLAYGROUND = '../';

/** A package README's page: its README as Markdown, and a link to its API when it has one. */
export function packagePage({ name, readme, published, entries }) {
	const api = entries.map(
		(specifier) => `<li><a href="../api/${pageName(specifier)}.html"><code>${escape(specifier)}</code></a></li>`
	);
	const status = published ? '' : '<p class="note">Not published to npm yet.</p>';
	const body = `${status}
${markdown.parse(readme)}
${api.length === 0 ? '' : `<h2 id="api">API</h2>\n<ul>${api.join('')}</ul>`}`;
	return page({ title: name, base: '../', body });
}

function exportSection(entry) {
	const doc = entry.doc === '' ? '<p class="muted">No description.</p>' : markdown.parse(entry.doc);
	const tags =
		entry.tags.length === 0
			? ''
			: `<ul class="tags">${entry.tags.map((tag) => `<li><code>${escape(tag)}</code></li>`).join('')}</ul>`;
	return `<section class="export" id="${escape(entry.name)}">
	<h2><code>${escape(entry.name)}</code> <span class="kind">${escape(entry.kind)}</span></h2>
	<pre><code>${escape(entry.declaration)}</code></pre>
	${doc}${tags}
</section>`;
}

/** One entry point's API: every export with its kind, declaration and doc comment. */
export function apiPage(specifier, exports) {
	const list = exports.map(({ name }) => `<a href="#${escape(name)}"><code>${escape(name)}</code></a>`).join(' · ');
	const body = `<h1><code>${escape(specifier)}</code></h1>
<p>${exports.length} exports, read from the package's type declarations.</p>
<p class="index">${list}</p>
${exports.map(exportSection).join('\n')}`;
	return page({ title: specifier, base: '../', body });
}

/** The API index: every public entry point of every published package. */
export function apiIndex(entries) {
	const items = entries
		.map(
			({ specifier, count }) =>
				`<li><a href="${pageName(specifier)}.html"><code>${escape(specifier)}</code></a> (${count})</li>`
		)
		.join('\n');
	return page({
		title: 'API',
		base: '../',
		body: `<h1>API</h1>\n<p>Every public entry point of the published packages.</p>\n<ul>${items}</ul>`
	});
}

/** A link to an example in the playground, which shows the code with the runtime's verdict. */
const exampleLink = (id, title) =>
	`<li><a href="${PLAYGROUND}#${encodeURIComponent(id)}">${escape(title)}</a> <span class="muted">(${escape(id.split(':')[0])})</span></li>`;

function codeSection({ code, title, meaning, action }, { packages, examples }) {
	const shown = examples.slice(0, 6);
	const more =
		examples.length > shown.length
			? `<p class="muted">and ${String(examples.length - shown.length)} more in the playground.</p>`
			: '';
	const tried =
		shown.length === 0
			? ''
			: `<h3>Examples</h3><ul>${shown.map(({ id, title: name }) => exampleLink(id, name)).join('')}</ul>${more}`;
	return `<section class="code" id="${code}">
	<h2><code>${code}</code> ${escape(title)}</h2>
	${markdown.parse(meaning)}
	<p><strong>What to do:</strong> ${markdown.parseInline(action)}</p>
	<p class="muted">Reported by ${packages.map((name) => `<a href="packages/${pageName(name)}.html"><code>${escape(name)}</code></a>`).join(', ')}.</p>
	${tried}
</section>`;
}

/** Every `CFG_*` code by group: meaning, what to do, the packages that emit it, examples that show it. */
export function codesPage(groups, codes, facts) {
	const body = groups.map(({ id, title }) => {
		const own = codes.filter(({ group }) => group === id);
		return `<h2 class="group" id="${id}">${escape(title)}</h2>\n${own.map((entry) => codeSection(entry, facts.get(entry.code))).join('\n')}`;
	});
	const intro = `<h1>Codes</h1>
<p>Every finding has a code. A code says what kind of finding it is; its severity (error, warning, info) and confidence say how sure it is: an <em>error</em> is a confirmed problem the runtime rejects or misreads, a <em>warning</em> a likely one or a problem without a crash, <em>info</em> a note about what could not be checked. The quality review's codes (<code>VIS_*</code>) are on the <a href="rules.html">quality rules</a> page.</p>
<p class="index">${codes.map(({ code }) => `<a href="#${code}"><code>${code}</code></a>`).join(' · ')}</p>`;
	return page({ title: 'Codes', base: '', body: `${intro}\n${body.join('\n')}` });
}

const evidenceItem = ({ authors, title, venue, year }) =>
	`<li>${escape(authors)}: <cite>${escape(title)}</cite>. ${escape(venue)}, ${String(year)}.</li>`;

function ruleSection(rule) {
	const context =
		rule.context.length === 0
			? ''
			: `<h3>Context</h3><ul>${rule.context.map(({ fact, note }) => `<li><code>${escape(fact)}</code>: ${markdown.parseInline(note)}</li>`).join('')}</ul>`;
	const fix = rule.fix.offered ? markdown.parseInline(rule.fix.edit) : `None: ${markdown.parseInline(rule.fix.why)}`;
	return `<section class="rule" id="${rule.code}">
	<h2><code>${rule.code}</code> ${escape(rule.title)}</h2>
	<p class="muted">Rule <code id="${escape(rule.id)}">${escape(rule.id)}</code> · ${escape(rule.severity)} · ${escape(rule.impact)}</p>
	${markdown.parse(rule.rationale)}
	<p><strong>Fix:</strong> ${fix}</p>
	${context}
	<h3>Limits</h3><ul>${rule.limits.map((limit) => `<li>${markdown.parseInline(limit)}</li>`).join('')}</ul>
	<h3>Sources</h3><ul>${rule.evidence.map(evidenceItem).join('')}</ul>
</section>`;
}

/** Every quality rule from its catalog: rationale, fix, context, documented limits and sources. */
export function rulesPage(rules) {
	const intro = `<h1>Quality rules</h1>
<p>The quality review is advice about how a chart reads, never a verdict: no error severity, no <code>valid</code>. Each rule says why, on what evidence, and where it can be wrong or silent.</p>
<p class="index">${rules.map(({ code }) => `<a href="#${code}"><code>${code}</code></a>`).join(' · ')}</p>`;
	return page({ title: 'Quality rules', base: '', body: `${intro}\n${rules.map(ruleSection).join('\n')}` });
}

/** The site's front page: the repository README, and every package with its one-line description. */
export function indexPage(readme, packages) {
	const list = packages
		.map(
			({ name, description, published }) =>
				`<li><a href="packages/${pageName(name)}.html"><code>${escape(name)}</code></a>${published ? '' : ' <span class="muted">(not published yet)</span>'}: ${escape(description)}</li>`
		)
		.join('\n');
	const body = `${markdown.parse(readme)}\n<h2 id="packages">Packages</h2>\n<ul class="packages">${list}</ul>`;
	return page({ title: 'Overview', base: '', body });
}

/** The search page: a field and the results its script lists from `search-index.json`. */
export function searchPage() {
	const body = `<h1>Search</h1>
<label class="search">Search the reference <input id="query" type="search" autocomplete="off" placeholder="CFG_TYPE, validate, bar baseline…" /></label>
<p id="status" class="muted" role="status"></p>
<ol id="results" class="results"></ol>`;
	return page({ title: 'Search', base: '', body, script: 'search.js' });
}
