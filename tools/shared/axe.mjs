import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { dumpDom } from './chrome.mjs';
import { serveDirectory } from './serve.mjs';

/**
 * An accessibility audit of a page in headless Chrome (CG-07-04): axe-core runs in the page once it
 * is ready and writes what it found into the DOM, which the harness reads back. axe-core and the
 * script that runs it are served from the page's own origin and added to the served copy of the
 * page only, so the page's Content-Security-Policy holds and no product code changes.
 */
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'));

/** WCAG 2.2 A and AA, and axe's best practices. */
export const AUDITED = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/**
 * Runs axe once the element `data-ready` names exists (at most 200 checks of 50 ms of the page's
 * virtual time: counted, never timed) and writes `{ ready, violations }` or `{ error }` into a
 * hidden `<pre id="axe-report">`.
 */
const RUNNER = `(() => {
	const ready = document.currentScript.dataset.ready;
	const tags = ${JSON.stringify(AUDITED)};
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
		window.axe
			.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] })
			.then(
				(result) =>
					report({
						ready: isReady(),
						violations: result.violations.map((violation) => ({
							id: violation.id,
							impact: violation.impact,
							help: violation.help,
							nodes: violation.nodes.map((node) => node.target.join(' '))
						}))
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

/**
 * The violations axe finds on `path` (with `query` and `hash`) of the site in `root`, once the
 * element `ready` names exists, in the `colorScheme` given. `headers` as for `serveDirectory`.
 */
export async function audit(root, path, { query = '', hash = '', ready, colorScheme = 'light', headers } = {}) {
	const tag = `<script src="/__axe.js"></script><script src="/__audit.js"${ready === undefined ? '' : ` data-ready="${ready.replaceAll('"', '&quot;')}"`}></script>`;
	const server = await serveDirectory(root, {
		headers,
		extra: { '/__axe.js': AXE, '/__audit.js': RUNNER },
		transform: (served, body) => (served === path ? body.toString('utf8').replace('</body>', `${tag}</body>`) : body)
	});
	try {
		const port = String(server.address().port);
		return axeReport(await dumpDom(`http://127.0.0.1:${port}${path}${query}${hash}`, { colorScheme }));
	} finally {
		server.close();
	}
}
