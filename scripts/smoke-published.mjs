import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAsEntryPoint } from '../tools/shared/entry.mjs';
import { publishedPackages } from '../tools/shared/workspace.mjs';

/**
 * After a release: what npm now serves, installed as a user installs it (the consumers job checked the
 * packed tarballs before publishing; this checks the registry). The CLI's bin runs on a config with a
 * confirmed error, and an adapter loads with `import` and with `require`.
 */
const STARTERS = ['@chartguard/cli', '@chartguard/config-chartjs'];

/** The packages a user starts with, at the versions this commit releases. */
export function smokePackages(manifests) {
	return STARTERS.map((name) => {
		const manifest = manifests.find((candidate) => candidate.name === name);
		if (manifest === undefined) throw new Error(`the release publishes no ${name}`);
		return `${name}@${manifest.version}`;
	});
}

/** Whether the CLI found the confirmed error in the invalid example: exit 1 and the `CFG_TYPE` finding. */
export const cliFoundError = ({ status, stdout }) => status === 1 && /\bCFG_TYPE\b/u.test(stdout);

/** A just-published version may take a while to be served: installs are tried this many times. */
const ATTEMPTS = 10;
const PAUSE_MS = 30_000;

const run = (command, args, cwd) => spawnSync(command, args, { cwd, encoding: 'utf8', shell: false });
const pause = () => new Promise((resolve) => setTimeout(resolve, PAUSE_MS));

async function install(project, packages) {
	for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
		const installed = run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', ...packages], project);
		if (installed.status === 0) return;
		console.log(`npm install, attempt ${String(attempt)} of ${String(ATTEMPTS)}: ${installed.stderr.trim()}`);
		if (attempt < ATTEMPTS) await pause();
	}
	throw new Error(`npm does not serve ${packages.join(', ')}`);
}

/** A config with a confirmed error: a linear scale's `min` given as a string. */
const BAD = "{ type: 'bar', data: { datasets: [] }, options: { scales: { y: { type: 'linear', min: '50' } } } }";

/** The adapter, loaded as a CommonJS and as an ES module consumer, finds the type error. */
const LOADS = [
	['-e', `const { validate } = require('@chartguard/config-chartjs'); if (validate(${BAD}).valid) process.exit(1);`],
	[
		'--input-type=module',
		'-e',
		`const { validate } = await import('@chartguard/config-chartjs'); if (validate(${BAD}).valid) process.exit(1);`
	]
];

async function main() {
	const root = fileURLToPath(new URL('..', import.meta.url));
	const packages = smokePackages(publishedPackages(root).map(({ manifest }) => manifest));
	const project = mkdtempSync(join(tmpdir(), 'chartguard-smoke-'));
	try {
		writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'smoke', private: true }));
		await install(project, packages);
		const example = join(root, 'examples', 'chartjs-invalid.json');
		const cli = run(
			'npx',
			['--no-install', 'chartguard', 'validate', '--library', 'chartjs', '--file', example],
			project
		);
		if (!cliFoundError(cli)) throw new Error(`the published CLI did not find the error:\n${cli.stdout}${cli.stderr}`);
		for (const args of LOADS) {
			const loaded = run(process.execPath, args, project);
			if (loaded.status !== 0) throw new Error(`the published adapter did not load (${args[0]}):\n${loaded.stderr}`);
		}
		console.log(`${packages.join(', ')}: installed from npm, the CLI runs, the adapter loads with import and require`);
		return 0;
	} finally {
		rmSync(project, { recursive: true, force: true });
	}
}

await runAsEntryPoint(import.meta.url, main);
