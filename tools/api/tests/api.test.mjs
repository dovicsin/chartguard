import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { currentSurfaces, SURFACES } from '../api.mjs';
import { compareSurfaces, parseSurface, surfaceOf } from '../surface.mjs';

test('the public API of every published package is the recorded one (backward compatibility, CG-00-07)', () => {
	for (const [packageName, text] of currentSurfaces()) {
		const file = join(SURFACES, `${packageName.replace('@', '').replace('/', '__')}.api.md`);
		const { breaking, additive } = compareSurfaces(parseSurface(readFileSync(file, 'utf8')), parseSurface(text));
		assert.deepEqual({ breaking, additive }, { breaking: [], additive: [] }, `${packageName}: review the change, choose the version bump, then run npm run api:write`);
	}
});

test('a removed or changed export is breaking, an added one additive', () => {
	const recorded = parseSurface('## pkg\n\n### a\nfunction a(): void;\n\n### b\ntype b = string;\n\n## pkg/sub\n\n### c\nconst c: number;\n');
	const current = parseSurface('## pkg\n\n### a\nfunction a(x: number): void;\n\n### d\ntype d = 1;\n\n## pkg/sub\n\n### c\nconst c: number;\n');
	assert.deepEqual(compareSurfaces(recorded, current), {
		breaking: ['changed pkg a', 'removed pkg b'],
		additive: ['added pkg d']
	});
	assert.deepEqual(compareSurfaces(current, current), { breaking: [], additive: [] });
});

test('a surface follows re-exports to their declarations and ignores comments', (t) => {
	const directory = mkdtempSync(join(tmpdir(), 'chartguard-api-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	writeFileSync(join(directory, 'impl.d.ts'), '/** Documented. */\nexport declare function run(input: string): number;\nexport interface Options { readonly depth?: number; }\n');
	writeFileSync(join(directory, 'index.d.ts'), "export { run as start } from './impl.js';\nexport type { Options } from './impl.js';\n");
	const surface = surfaceOf(join(directory, 'index.d.ts'));
	assert.deepEqual([...surface.keys()].sort(), ['Options', 'start']);
	assert.equal(surface.get('start'), 'function run(input: string): number;');
	assert.match(surface.get('Options'), /^interface Options \{\s+readonly depth\?: number;\s+\}$/);
});
