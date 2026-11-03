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

/**
 * Markdown as the reference renders it: raw HTML escaped (shown as text, never parsed), links only to
 * the web (https) or to an anchor (a relative link names a file of the repository, not of the site,
 * and stays text), headings with anchors.
 */
export const markdown = new Marked({
	renderer: {
		html({ text }) {
			return escape(text);
		},
		link({ href, tokens }) {
			const text = this.parser.parseInline(tokens);
			return isWebOrAnchor(href) ? `<a href="${escape(href)}">${text}</a>` : text;
		},
		image({ text }) {
			return escape(text);
		},
		heading({ tokens, depth }) {
			const text = this.parser.parseInline(tokens);
			return `<h${String(depth)} id="${slug(text)}">${text}</h${String(depth)}>\n`;
		}
	}
});

/** The site's sections, in the navigation's order: path from the site's root, and label. */
const SECTIONS = [
	{ path: 'index.html', label: 'Overview' },
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
