import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { main } from '../bin/chartguard.mjs';

export const example = (name) => fileURLToPath(new URL(`../../../examples/${name}`, import.meta.url));

/** Runs the CLI in process and collects what it prints. */
export async function run(argv) {
	const out = [];
	const err = [];
	const code = await main(argv, { out: (line) => out.push(line), err: (line) => err.push(line) });
	return { code, out: out.join('\n'), err: err.join('\n') };
}

/** A project directory with the given files; removed after the test. */
export function sourceProject(t, files) {
	const root = mkdtempSync(join(tmpdir(), 'chartguard-cli-project-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	for (const [name, text] of Object.entries(files)) {
		mkdirSync(join(root, name, '..'), { recursive: true });
		writeFileSync(join(root, name), text);
	}
	return root;
}
