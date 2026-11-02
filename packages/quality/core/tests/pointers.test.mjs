import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { checkPointers } from './pointers.mjs';

/** The pointer check on a module holding `pointer` (a string literal), in a temporary directory. */
function check(pointer) {
	const directory = mkdtempSync(join(tmpdir(), 'chartguard-pointers-'));
	try {
		const source = join(directory, 'source.ts');
		writeFileSync(source, `const POINTER = ${JSON.stringify(pointer)};\n`);
		return checkPointers(source);
	} catch (error) {
		return error.message.split('\n')[0];
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test('a pointer names exactly one place: a generic text needs the context that makes it distinctive', () => {
	// `show: true,` is on 65 lines of the file: alone it could point at any option that holds it.
	assert.match(String(check('echarts@6.1.0 dist/echarts.js:84452 show: true,')), /is on lines 47121, /);
	assert.equal(check('echarts@6.1.0 dist/echarts.js:84452 show: true, [in TitleModel.defaultOption]'), 1);
	// The same text and context at another option's line: that line is not in the context.
	assert.match(
		String(check('echarts@6.1.0 dist/echarts.js:48470 show: true, [in TitleModel.defaultOption]')),
		/is on lines 84452;/
	);
	assert.equal(check('echarts@6.1.0 dist/echarts.js:48470 show: true, [after mixin(CartesianAxisModel]'), 1);
	// A text inside a longer name is not that text: `subtext: ''` does not hold `text: ''`.
	assert.equal(check("echarts@6.1.0 dist/echarts.js:84453 text: '', [in TitleModel.defaultOption]"), 1);
	// A context names a whole word: EffectScatterSeriesModel is not ScatterSeriesModel.
	assert.equal(
		check("echarts@6.1.0 dist/echarts.js:48071 coordinateSystem: 'cartesian2d', [in ScatterSeriesModel.defaultOption]"),
		1
	);
	// A distinctive text needs no context; a line that does not hold the text fails.
	assert.equal(check("echarts@6.1.0 dist/echarts.js:18872 theme: ['#5070dd',"), 1);
	assert.match(String(check('echarts@6.1.0 dist/echarts.js:18873 animationThreshold: 2000,')), /line 18873 is/);
});
