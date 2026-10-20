import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runAsEntryPoint } from '../tools/shared/entry.mjs';

/**
 * The repository's issue labels (CG-00-05), from scripts/labels.json. Prints the `gh` commands by
 * default; `--apply` runs them against the repository `gh` is logged in to, which only the
 * maintainer does: it changes the public repository.
 */
export const LABELS = JSON.parse(readFileSync(fileURLToPath(new URL('labels.json', import.meta.url)), 'utf8'));

export const commandOf = ({ name, color, description }) => [
	'label',
	'create',
	name,
	'--color',
	color,
	'--description',
	description,
	'--force'
];

async function main(argv) {
	const apply = argv.includes('--apply');
	for (const label of LABELS) {
		const args = commandOf(label);
		if (!apply) {
			process.stdout.write(`gh ${args.map((arg) => JSON.stringify(arg)).join(' ')}\n`);
			continue;
		}
		const result = spawnSync('gh', args, { stdio: 'inherit', shell: process.platform === 'win32' });
		if (result.status !== 0) return result.status ?? 1;
	}
	return 0;
}

await runAsEntryPoint(import.meta.url, main);
