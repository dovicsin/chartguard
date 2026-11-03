import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTests } from '@vscode/test-electron';

import { runAsEntryPoint } from '../../../../tools/shared/entry.mjs';

/** The extension package and this checkout, wherever this script is run from (E7). */
const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const ROOT = join(PACKAGE, '..', '..', '..');

/**
 * Runs `tests/vscode/suite.cjs` in a real VS Code with the extension under development and
 * `tests/vscode/workspace` open (CG-06-05). VS Code is downloaded once into node_modules/.cache, or taken
 * from `VSCODE_EXECUTABLE`; on Linux without a display run it under `xvfb-run`.
 */
await runAsEntryPoint(import.meta.url, async () => {
	const executable = process.env['VSCODE_EXECUTABLE'];
	// A terminal inside VS Code sets it, and VS Code started with it runs as plain Node.
	delete process.env['ELECTRON_RUN_AS_NODE'];
	// A profile of its own, removed afterwards: nothing is written into the checkout or the user's VS Code.
	const profile = mkdtempSync(join(tmpdir(), 'chartguard-vscode-'));
	try {
		await runTests({
			extensionDevelopmentPath: PACKAGE,
			extensionTestsPath: join(PACKAGE, 'tests', 'vscode', 'suite.cjs'),
			cachePath: join(ROOT, 'node_modules', '.cache', 'vscode-test'),
			launchArgs: [
				join(PACKAGE, 'tests', 'vscode', 'workspace'),
				`--user-data-dir=${join(profile, 'user-data')}`,
				`--extensions-dir=${join(profile, 'extensions')}`,
				'--disable-extensions',
				'--disable-workspace-trust'
			],
			...(executable === undefined ? {} : { vscodeExecutablePath: executable })
		});
	} finally {
		rmSync(profile, { recursive: true, force: true });
	}
	return 0;
});
