import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAsEntryPoint } from '../tools/shared/entry.mjs';

/**
 * E97: the schemas are pinned to the newest release of each chart library (CG-07-01: the latest
 * only; another version of the same major is checked with warnings). This lists every library whose
 * newest stable release on npm is newer than its pin, one issue each (`title<TAB>body` per line), for
 * the upstream workflow to open once.
 */
const STABLE = /^(\d+)\.(\d+)\.(\d+)$/u;

/** Whether stable version `candidate` is newer than `pinned`; false when either is not `MAJOR.MINOR.PATCH`. */
export function isNewer(candidate, pinned) {
	const [a, b] = [STABLE.exec(candidate), STABLE.exec(pinned)];
	if (a === null || b === null) return false;
	for (let index = 1; index <= 3; index++)
		if (Number(a[index]) !== Number(b[index])) return Number(a[index]) > Number(b[index]);
	return false;
}

/** One issue per pinned package whose `latest` release (`latestOf(package)`) is newer than its pin. */
export function releaseIssues(pins, latestOf) {
	return pins.flatMap(({ package: name, version }) => {
		const latest = latestOf(name);
		if (latest === undefined || !isNewer(latest, version)) return [];
		return [
			{
				title: `Upstream release: ${name} ${latest}`,
				body: `${name} ${latest} is the newest release on npm; the schema is pinned to ${version}. Supported is the latest only: move the pin in packages/schema-generator/upstream-sources.json and the root package.json, regenerate the schema (npm run schema:generate), and let the conformance tests and the runtime pointer checks show what changed.`
			}
		];
	});
}

/** The newest release npm's `latest` tag names, or undefined when npm cannot say. */
function latestOnNpm(name) {
	const result = spawnSync('npm', ['view', name, 'version'], { encoding: 'utf8', shell: process.platform === 'win32' });
	const version = result.stdout.trim();
	return result.status === 0 && STABLE.test(version) ? version : undefined;
}

await runAsEntryPoint(import.meta.url, () => {
	const root = fileURLToPath(new URL('..', import.meta.url));
	const { libraries } = JSON.parse(
		readFileSync(join(root, 'packages', 'schema-generator', 'upstream-sources.json'), 'utf8')
	);
	for (const { title, body } of releaseIssues(libraries, latestOnNpm)) process.stdout.write(`${title}\t${body}\n`);
});
