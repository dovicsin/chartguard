import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { audit, AUDITED, axeReport } from '../axe.mjs';
import { browserSkipReason } from '../chrome.mjs';

/** A report as a page writes it into the DOM (`textContent`, so quotes and brackets are escaped). */
const written = (value) =>
	`<pre id="axe-report" hidden="">${JSON.stringify(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')}</pre>`;

test('the audit covers WCAG 2.2 A and AA and axe best practices', () => {
	for (const tag of ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'])
		assert.ok(AUDITED.includes(tag), tag);
});

test('a report is read in shape: anything else is an error, never a pass', () => {
	const violations = [{ id: 'reflow', impact: 'serious', help: 'h', nodes: ['div.a<b>'] }];
	assert.deepEqual(axeReport(written({ ready: true, violations })), violations);
	assert.deepEqual(axeReport(written({ ready: true, violations: [] })), []);
	assert.throws(() => axeReport('<html></html>'), /wrote no accessibility report/u);
	assert.throws(() => axeReport(written({ error: 'boom' })), /axe failed: boom/u);
	assert.throws(() => axeReport(written({ ready: false, violations: [] })), /never became ready/u);
	assert.throws(() => axeReport(written({ ready: true })), /no violations list/u);
});

/** A one-page site of `body`, with a strict policy like the real sites (no inline style or script). */
function site(t, body, css = '') {
	const root = mkdtempSync(join(tmpdir(), 'chartguard-axe-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeFileSync(
		join(root, 'index.html'),
		`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'self'"><title>Audit</title><link rel="stylesheet" href="/styles.css"></head><body><main><h1>Audit</h1>${body}</main></body></html>`
	);
	writeFileSync(
		join(root, 'styles.css'),
		`.wide { width: 900px; } .bare:focus { outline: none; } .cut { height: 1.2em; overflow: hidden; width: 200px; } .scroller { overflow-x: auto; } .scroller div { width: 900px; }${css}`
	);
	return root;
}

const browser = { skip: browserSkipReason() ?? false, timeout: 120_000 };
const ids = (violations) => violations.map(({ id }) => id).sort();

test(
	'the checks axe does not make find what they are about, and pass a page without it (CG-07-04)',
	browser,
	async (t) => {
		const narrow = { windowSize: [320, 640], reflow: true, spacing: true };
		const bad = site(
			t,
			'<p class="wide">Too wide for a narrow screen.</p><button class="bare">No focus mark</button><p class="cut">A line of text that wraps once its letters are spaced as WCAG asks.</p>'
		);
		const found = await audit(bad, '/index.html', narrow);
		assert.deepEqual(ids(found), ['focus-visible', 'reflow', 'text-spacing']);
		assert.deepEqual(found.find(({ id }) => id === 'reflow').nodes, ['p.wide']);
		assert.deepEqual(found.find(({ id }) => id === 'focus-visible').nodes, ['button.bare']);
		assert.deepEqual(found.find(({ id }) => id === 'text-spacing').nodes, ['p.cut']);
		// Wide content that scrolls itself is exempt (two-dimensional content); a default focus ring counts.
		const good = site(
			t,
			'<div class="scroller" tabindex="0"><div>A wide table or code block.</div></div><button>Marked</button>'
		);
		assert.deepEqual(await audit(good, '/index.html', narrow), []);
		// Without the narrow window and its checks, only what applies everywhere is checked.
		assert.deepEqual(ids(await audit(bad, '/index.html')), ['focus-visible']);
	}
);

test(
	'a page whose root scrolls sideways itself is not exempt from reflow: the whole page scrolls (CG-07-04)',
	browser,
	async (t) => {
		const narrow = { windowSize: [320, 640], reflow: true };
		// With both roots scrolling, the body is a scroll container of its own: nothing was found.
		for (const root of ['html, body', 'body', 'html']) {
			const page = site(t, '<p class="wide">Too wide for a narrow screen.</p>', ` ${root} { overflow-x: auto; }`);
			const found = await audit(page, '/index.html', narrow);
			assert.deepEqual(ids(found), ['reflow'], root);
			assert.deepEqual(found[0].nodes, ['p.wide'], root);
		}
	}
);
