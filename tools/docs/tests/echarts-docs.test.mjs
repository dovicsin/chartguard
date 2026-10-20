import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { anchorsOf, deprecationAnchors, DOCS_FILE } from '../echarts-docs.mjs';

const ARTIFACT = fileURLToPath(new URL('../../../packages/config/echarts/src/generated/echarts-6.1.0.json', import.meta.url));

test('every pinned anchor is one the current schema links a deprecation to: regenerating the schema re-checks the data', () => {
	const wanted = deprecationAnchors(JSON.parse(readFileSync(ARTIFACT, 'utf8')));
	const pinned = JSON.parse(readFileSync(DOCS_FILE, 'utf8')).anchors;
	assert.deepEqual(pinned.filter((anchor) => !wanted.has(anchor)), []);
	assert.ok(wanted.has('series-pie.label.edgeDistance') && wanted.has('grid.outerBounds'));
});

test('anchors are named the way the documentation names them', () => {
	const outline = {
		children: [
			{ prop: 'title', children: [{ prop: 'text' }] },
			{ prop: 'series', isArray: true, children: [{ arrayItemType: 'pie', children: [{ prop: 'label', children: [{ prop: 'edgeDistance' }] }] }] }
		]
	};
	assert.deepEqual(anchorsOf(outline), ['title', 'title.text', 'series', 'series-pie.label', 'series-pie.label.edgeDistance']);
});
