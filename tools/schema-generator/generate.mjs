import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { generateChartjs } from './lib/chartjs.mjs';
import { verifiedUpstream } from './lib/lock.mjs';

const GENERATORS = { chartjs: { package: 'packages/config/chartjs', generate: generateChartjs } };

export function artifactPath(root, library, version) {
	return join(root, GENERATORS[library].package, 'src/generated', `${library}-${version}.json`);
}

/** Deterministic artifact text for one library. */
export function generate(root, library) {
	const pin = verifiedUpstream(root, library);
	const artifact = GENERATORS[library].generate(root, pin);
	return { path: artifactPath(root, library, pin.version), text: `${JSON.stringify(artifact, null, '\t')}\n` };
}

function run([mode = 'write', ...libraries]) {
	const stale = [];
	for (const library of libraries.length > 0 ? libraries : Object.keys(GENERATORS)) {
		const { path, text } = generate(process.cwd(), library);
		if (mode === 'check') {
			let current = '';
			try {
				current = readFileSync(path, 'utf8');
			} catch {
				current = '';
			}
			if (current !== text) stale.push(path);
		} else {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, text);
		}
	}
	return stale;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const stale = run(process.argv.slice(2));
	for (const path of stale) process.stderr.write(`Stale schema artifact: ${path}; run npm run schema:generate\n`);
	process.exitCode = stale.length > 0 ? 1 : 0;
}
