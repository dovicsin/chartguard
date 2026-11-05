import { Marked } from 'marked';

/** Text as HTML text or attribute value. */
export const escape = (text) =>
	String(text)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');

/** A heading's anchor: lower case, words joined by `-`; stable across builds. */
const slug = (text) =>
	String(text)
		.toLowerCase()
		.replaceAll(/<[^>]*>/gu, '')
		.replaceAll(/[^a-z0-9_]+/gu, '-')
		.replaceAll(/^-|-$/gu, '');

/** Whether a link leaves the site for the web, or stays on the page. */
const isWebOrAnchor = (href) => /^https:\/\//u.test(href) || href.startsWith('#');

/** A relative link to a page of the site or the playground beside it (`../codes.html#CFG_TYPE`, `../../`). */
const isSitePage = (href) => /^(?:\.\.\/)*(?:[\w-]+\/)*(?:[\w-]+\.html(?:#[\w-]+)?)?$/u.test(href) && href !== '';

/**
 * Markdown as the reference renders it: raw HTML escaped (shown as text, never parsed), links to the
 * web (https), to an anchor and, for the site's own pages (`sitePages`), to its pages; a relative link
 * of a README names a file of the repository, not of the site, and stays text. Headings with anchors,
 * code blocks reachable by keyboard.
 */
function markdownWith(sitePages) {
	const linked = (href) => isWebOrAnchor(href) || (sitePages && isSitePage(href));
	return new Marked({
		renderer: {
			html({ text }) {
				return escape(text);
			},
			link({ href, tokens }) {
				const text = this.parser.parseInline(tokens);
				return linked(href) ? `<a href="${escape(href)}">${text}</a>` : text;
			},
			image({ text }) {
				return escape(text);
			},
			// A code block may scroll sideways: it can take the keyboard's focus to be scrolled (WCAG 2.1.1).
			// It is not a named region: a page holds many, and landmarks must be told apart by name.
			code({ text, lang }) {
				const language = lang?.split(/\s/u)[0] ?? '';
				const type = language === '' ? '' : ` class="language-${escape(language)}"`;
				return `<pre tabindex="0"><code${type}>${escape(text)}\n</code></pre>\n`;
			},
			heading({ tokens, depth }) {
				const text = this.parser.parseInline(tokens);
				return `<h${String(depth)} id="${slug(text)}">${text}</h${String(depth)}>\n`;
			}
		}
	});
}

/** READMEs and doc comments: their relative links name repository files and stay text. */
export const markdown = markdownWith(false);

/** The guides, written for the site: their relative links are its pages, each checked to resolve. */
export const guideMarkdown = markdownWith(true);

/** The site's sections, in the navigation's order: path from the site's root, and label. */
const SECTIONS = [
	{ path: 'index.html', label: 'Overview' },
	{ path: 'guides/getting-started.html', label: 'Guides' },
	{ path: 'api/index.html', label: 'API' },
	{ path: 'codes.html', label: 'Codes' },
	{ path: 'rules.html', label: 'Quality rules' },
	{ path: 'search.html', label: 'Search' }
];

/**
 * A page of the site: `base` is the relative URL back to the site's top (`''`, `'../'`). Scripts
 * from the site only, no inline script, no network beyond the site itself.
 */
export function page({ title, base, body, script }) {
	const nav = SECTIONS.map(({ path, label }) => `<a href="${base}${path}">${escape(label)}</a>`).join('\n\t\t\t\t');
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<meta
			http-equiv="Content-Security-Policy"
			content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"
		/>
		<title>${escape(title)} · ChartGuard reference</title>
		<link rel="stylesheet" href="${base}styles.css" />
		${script === undefined ? '' : `<script type="module" src="${base}${script}"></script>`}
	</head>
	<body>
		<header class="bar">
			<a class="bar__title" href="${base}index.html">ChartGuard <span>reference</span></a>
			<nav class="bar__nav">
				${nav}
				<a href="${base}../">Playground</a>
			</nav>
		</header>
		<main class="content">
${body}
		</main>
		<footer class="footer">Generated from the packages’ READMEs, declarations and catalogs.</footer>
	</body>
</html>
`;
}
