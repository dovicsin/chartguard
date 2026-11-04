import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { audit } from '../../../tools/shared/axe.mjs';
import { browserSkipReason } from '../../../tools/shared/chrome.mjs';
import { skipOutsideCi } from '../../../tools/shared/ci.mjs';
import { OUT } from '../scripts/build.mjs';
import { markdown } from '../scripts/html.mjs';

/**
 * The reference's accessibility (CG-07-04): axe-core finds no WCAG 2.2 A/AA violation nor best
 * practice, in the light and the dark scheme, on a page of each kind the site is built from (every
 * page of a kind comes from the same template): the overview with a package README, the API index,
 * an API page with many declarations, the codes, the rules, and the search page with results.
 */
const PAGES = [
	{ path: '/index.html' },
	{ path: '/packages/config-core.html' },
	{ path: '/api/index.html' },
	{ path: '/api/config-core.html' },
	{ path: '/codes.html' },
	{ path: '/rules.html' },
	{ path: '/search.html', query: '?q=CFG_TYPE', ready: '[data-ready="true"]' }
];

const skip =
	// On CI a missing browser or site fails the gate instead of skipping it (E22).
	browserSkipReason() ?? (existsSync(join(OUT, 'index.html')) ? false : skipOutsideCi('needs a built reference'));

test(
	'the pages audited exist',
	{ skip: existsSync(join(OUT, 'index.html')) ? false : 'needs a built reference' },
	() => {
		for (const { path } of PAGES) assert.ok(existsSync(join(OUT, path)), path);
	}
);

test('a code block, which may scroll, is reachable by keyboard', () => {
	const html = markdown.parse('```js\nconst a = 1;\n```\n\n```\nplain\n```');
	assert.match(html, /<pre tabindex="0"><code class="language-js">const a = 1;\n<\/code><\/pre>/u);
	assert.match(html, /<pre tabindex="0"><code>plain\n<\/code><\/pre>/u);
	assert.doesNotMatch(markdown.parse('```\n<b>x</b>\n```'), /<b>/u, 'the code is escaped');
});

for (const colorScheme of ['light', 'dark'])
	for (const { path, query = '', ready } of PAGES)
		test(`${path}${query}, ${colorScheme}: no accessibility violation`, { skip, timeout: 120_000 }, async () => {
			assert.deepEqual(await audit(OUT, path, { query, ready, colorScheme }), []);
		});

// A narrow screen (or a 1280-pixel window zoomed to 400 %): nothing sticks out sideways (WCAG 1.4.10),
// and no text is cut off with WCAG text spacing applied (WCAG 1.4.12).
for (const { path, query = '', ready } of PAGES)
	test(
		`${path}${query}, 320 CSS pixels wide, text spaced: no accessibility violation`,
		{ skip, timeout: 120_000 },
		async () => {
			assert.deepEqual(
				await audit(OUT, path, { query, ready, windowSize: [320, 640], reflow: true, spacing: true }),
				[]
			);
		}
	);
