import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTests } from '@vscode/test-electron';

import { runAsEntryPoint } from '../../../../tools/shared/entry.mjs';

/** The extension package and this checkout, wherever this script is run from (E7). */
const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const ROOT = join(PACKAGE, '..', '..', '..');

/**
 * The VS Code the tests run in, exact: the latest stable changes under the tests (1.144 opens the chat
 * view and an agent host at startup), so a new one is taken deliberately. `VSCODE_EXECUTABLE` overrides.
 */
export const VSCODE_VERSION = '1.144.1';

/**
 * The test profile's settings: nothing opens beside the test's editor (a view or editor taking focus
 * cancels `showTextDocument`), no AI features, no updates, no telemetry.
 */
export const SETTINGS = {
	'workbench.startupEditor': 'none',
	'workbench.secondarySideBar.defaultVisibility': 'hidden',
	'chat.disableAIFeatures': true,
	'update.mode': 'none',
	'extensions.autoCheckUpdates': false,
	'telemetry.telemetryLevel': 'off'
};
/** Launch flags that keep the welcome page and release notes closed. */
export const QUIET_FLAGS = ['--skip-welcome', '--skip-release-notes'];

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
	mkdirSync(join(profile, 'user-data', 'User'), { recursive: true });
	writeFileSync(join(profile, 'user-data', 'User', 'settings.json'), JSON.stringify(SETTINGS));
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
				'--disable-workspace-trust',
				...QUIET_FLAGS
			],
			...(executable === undefined ? { version: VSCODE_VERSION } : { vscodeExecutablePath: executable })
		});
	} finally {
		rmSync(profile, { recursive: true, force: true });
	}
	return 0;
});
