import { fileURLToPath } from 'node:url';

import { runAsEntryPoint } from '../tools/shared/entry.mjs';
import { POLICY } from './boundaries/policy.mjs';
import { checkWorkspace, workspacePackages } from './boundaries/workspace.mjs';

/** This checkout, wherever the script is run from (E7). */
const ROOT = fileURLToPath(new URL('..', import.meta.url));

function main() {
	const violations = checkWorkspace(ROOT, POLICY);
	for (const { packageName, file, line, message } of violations)
		console.error(`${packageName} ${file}:${line}: ${message}`);
	if (violations.length > 0) return 1;
	console.log(`Package boundaries respected (${String(workspacePackages(ROOT).length)} packages).`);
	return 0;
}

await runAsEntryPoint(import.meta.url, main);
