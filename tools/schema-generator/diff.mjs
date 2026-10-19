import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAsEntryPoint } from '../shared/entry.mjs';
import { generate, LIBRARIES } from './generate.mjs';
import { diffArtifacts, formatDiff } from './lib/diff.mjs';

/**
 * `node tools/schema-generator/diff.mjs <library> [--base <git-ref> | --base-file <path>] [--json]`
 * compares a freshly generated artifact with the committed one (default `--base HEAD`), by meaning.
 */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const EXIT_USAGE = 2;

function baseText(path, { ref, file }) {
	if (file !== undefined) return readFileSync(file, 'utf8');
	const shown = spawnSync('git', ['show', `${ref}:${relative(ROOT, path)}`], {
		cwd: ROOT,
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024
	});
	if (shown.status !== 0) throw new Error(`git show ${ref}: ${shown.error?.message ?? shown.stderr.trim()}`);
	return shown.stdout;
}

function parseArguments([library, ...rest]) {
	const options = { ref: 'HEAD', file: undefined, json: false };
	for (let index = 0; index < rest.length; index++) {
		const flag = rest[index];
		if (flag === '--json') options.json = true;
		else if (flag === '--base') options.ref = rest[++index];
		else if (flag === '--base-file') options.file = rest[++index];
		else return undefined;
	}
	return LIBRARIES.includes(library) && options.ref !== undefined ? { library, ...options } : undefined;
}

function main(argv) {
	const options = parseArguments(argv);
	if (options === undefined) {
		process.stderr.write(`Usage: diff.mjs <${LIBRARIES.join('|')}> [--base <git-ref> | --base-file <path>] [--json]\n`);
		return EXIT_USAGE;
	}
	const current = generate(ROOT, options.library);
	const before = JSON.parse(baseText(current.path, options));
	const after = JSON.parse(current.text);
	const changes = diffArtifacts(before, after);
	if (options.json) process.stdout.write(`${JSON.stringify({ before: before.digest, after: after.digest, changes }, null, 2)}\n`);
	else {
		process.stdout.write(`${options.library} ${before.libraryVersion} ${String(before.digest)} -> ${after.libraryVersion} ${after.digest}\n`);
		for (const line of formatDiff(changes)) process.stdout.write(`${line}\n`);
		process.stdout.write(`${String(changes.length)} change(s)\n`);
	}
	return 0;
}

await runAsEntryPoint(import.meta.url, main);
