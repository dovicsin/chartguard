import { readFileSync } from 'node:fs';

import { dumpDom } from './chrome.mjs';
import { serveDirectory } from './serve.mjs';

/**
 * An accessibility audit of a page in headless Chrome (CG-07-04): axe-core runs in the page once it
 * is ready and writes what it found into the DOM, which the harness reads back. axe-core and the
 * script that runs it are served from the page's own origin and added to the served copy of the
 * page only, so the page's Content-Security-Policy holds and no product code changes.
 */
const AXE = readFileSync(new URL(import.meta.resolve('axe-core/axe.min.js')));

/** WCAG 2.2 A and AA, and axe's best practices. */
export const AUDITED = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/**
 * Checks axe does not make, run in the same page (CG-07-04), each reported like an axe violation:
 * - `focus-visible` (WCAG 2.4.7): every element the keyboard reaches shows an outline or a shadow when
 *   it has the focus;
 * - `reflow` (WCAG 1.4.10), in a narrow window: nothing sticks out sideways, except inside an element
 *   that scrolls sideways itself (code, tables: two-dimensional content the criterion exempts);
 * - `text-spacing` (WCAG 1.4.12): with the criterion's spacing applied, no text is cut off by an
 *   element that hides what overflows (a visually hidden element of a pixel is left out).
 */
const CHECKS = `
	const label = (element) =>
		element.tagName.toLowerCase() + (element.id ? '#' + element.id : '') + (element.classList.length ? '.' + element.classList[0] : '');
	const violation = (id, help, nodes) => (nodes.length === 0 ? [] : [{ id, impact: 'serious', help, nodes }]);
	const visible = (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
	const focusVisible = () => {
		const unmarked = [];
		for (const element of document.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]')) {
			if (element.disabled || element.tabIndex < 0 || !visible(element)) continue;
			element.focus({ focusVisible: true });
			if (document.activeElement !== element) continue;
			const style = getComputedStyle(element);
			const ring = (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none';
			if (!ring) unmarked.push(label(element));
			element.blur();
		}
		return violation('focus-visible', 'Every focusable element shows where the focus is (WCAG 2.4.7)', unmarked);
	};
	const scrollsItself = (element) => {
		for (let node = element.parentElement; node !== null; node = node.parentElement) {
			const overflow = getComputedStyle(node).overflowX;
			if (overflow === 'auto' || overflow === 'scroll') return true;
		}
		return false;
	};
	const reflow = () => {
		const width = document.documentElement.clientWidth;
		const wide = [...document.body.querySelectorAll('*')].filter((element) => {
			const box = element.getBoundingClientRect();
			return box.width > 0 && box.right > width + 1 && !scrollsItself(element);
		});
		const outermost = wide.filter((element) => !wide.includes(element.parentElement)).map(label);
		const page = document.documentElement.scrollWidth > width + 1 && outermost.length === 0 ? ['html'] : [];
		return violation('reflow', 'Content fits the narrow window without scrolling sideways (WCAG 1.4.10)', [...outermost, ...page]);
	};
	const SPACING = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }';
	const textSpacing = () => {
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(SPACING);
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
		const hides = (overflow) => overflow === 'hidden' || overflow === 'clip';
		const cut = [...document.body.querySelectorAll('*')].filter((element) => {
			if (element.textContent.trim() === '' || !visible(element)) return false;
			const box = element.getBoundingClientRect();
			if (box.width <= 1 || box.height <= 1) return false;
			const style = getComputedStyle(element);
			return (
				(hides(style.overflowX) && element.scrollWidth > element.clientWidth + 1) ||
				(hides(style.overflowY) && element.scrollHeight > element.clientHeight + 1)
			);
		});
		document.adoptedStyleSheets = document.adoptedStyleSheets.filter((other) => other !== sheet);
		return violation('text-spacing', 'No text is cut off with WCAG text spacing applied (WCAG 1.4.12)', cut.map(label));
	};
`;

/**
 * Runs axe and the checks above once the element `data-ready` names exists (at most 200 checks of
 * 50 ms of the page's virtual time: counted, never timed) and writes `{ ready, violations }` or
 * `{ error }` into a hidden `<pre id="axe-report">`. `data-reflow` and `data-spacing` turn the
 * reflow and text-spacing checks on.
 */
const RUNNER = `(() => {
	const { ready, reflow: narrow, spacing } = document.currentScript.dataset;
	const tags = ${JSON.stringify(AUDITED)};
	${CHECKS}
	const report = (value) => {
		const pre = document.createElement('pre');
		pre.id = 'axe-report';
		pre.hidden = true;
		pre.textContent = JSON.stringify(value);
		document.body.append(pre);
	};
	const isReady = () => ready === undefined || document.querySelector(ready) !== null;
	let checks = 0;
	const run = () => {
		if (!isReady() && checks++ < 200) return void setTimeout(run, 50);
		const own = [...(narrow === 'true' ? reflow() : []), ...focusVisible()];
		window.axe
			.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] })
			.then(
				(result) =>
					report({
						ready: isReady(),
						violations: [
							...own,
							...result.violations.map((violation) => ({
								id: violation.id,
								impact: violation.impact,
								help: violation.help,
								nodes: violation.nodes.map((node) => node.target.join(' '))
							})),
							...(spacing === 'true' ? textSpacing() : [])
						]
					}),
				(error) => report({ error: String(error) })
			);
	};
	window.addEventListener('load', () => setTimeout(run, 0));
})();
`;

const unescape = (text) =>
	text.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

/** The report a page wrote, checked in shape: anything else is an error, never a pass. */
export function axeReport(html) {
	const found = /<pre id="axe-report" hidden="">([^<]*)<\/pre>/u.exec(html);
	if (found === null) throw new Error('the page wrote no accessibility report');
	const report = JSON.parse(unescape(found[1]));
	if (typeof report.error === 'string') throw new Error(`axe failed: ${report.error}`);
	if (report.ready !== true) throw new Error('the page never became ready to be audited');
	if (!Array.isArray(report.violations)) throw new Error('the accessibility report has no violations list');
	return report.violations;
}

/** The script tags the served copy of an audited page gets, with the checks asked for. */
function auditTags({ ready, reflow, spacing }) {
	const attributes = [
		ready === undefined ? '' : ` data-ready="${ready.replaceAll('"', '&quot;')}"`,
		reflow ? ' data-reflow="true"' : '',
		spacing ? ' data-spacing="true"' : ''
	].join('');
	return `<script src="/__axe.js"></script><script src="/__audit.js"${attributes}></script>`;
}

/**
 * The violations axe and the checks above find on `path` (with `query` and `hash`) of the site in
 * `root`, once the element `ready` names exists, in the `colorScheme` given. `windowSize` sizes the
 * window (`[320, 640]`: the narrow screen of WCAG 1.4.10, or a 1280-pixel page zoomed to 400 %), and
 * `reflow` then checks nothing sticks out sideways; `spacing` checks text spacing. `headers` as for
 * `serveDirectory`.
 */
export async function audit(
	root,
	path,
	{ query = '', hash = '', ready, colorScheme = 'light', headers, windowSize, reflow = false, spacing = false } = {}
) {
	const tag = auditTags({ ready, reflow, spacing });
	const server = await serveDirectory(root, {
		headers,
		extra: { '/__axe.js': AXE, '/__audit.js': RUNNER },
		transform: (served, body) => (served === path ? body.toString('utf8').replace('</body>', `${tag}</body>`) : body)
	});
	try {
		const port = String(server.address().port);
		return axeReport(await dumpDom(`http://127.0.0.1:${port}${path}${query}${hash}`, { colorScheme, windowSize }));
	} finally {
		server.close();
	}
}
