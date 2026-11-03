import { join } from 'node:path';

import { commands, type ExtensionContext, workspace } from 'vscode';
import {
	LanguageClient,
	type LanguageClientOptions,
	type ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';

import { settingsOf } from './settings.js';

/** The languages the server checks, in saved files and unsaved buffers alike. */
const LANGUAGES = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'];

let client: LanguageClient | undefined;

/** The editor's `chartguard` settings, as the server takes them. */
const editorSettings = (): Record<string, unknown> => ({
	chartguard: settingsOf(workspace.getConfiguration('chartguard'))
});

/**
 * ChartGuard for VS Code (CG-06-05): the client of `@chartguard/language-server`, bundled with the
 * extension and run in its own process; the extension itself reads no file and runs nothing.
 */
export async function activate(context: ExtensionContext): Promise<void> {
	const module = context.asAbsolutePath(join('dist', 'server.cjs'));
	const serverOptions: ServerOptions = {
		run: { module, transport: TransportKind.stdio },
		debug: { module, transport: TransportKind.stdio }
	};
	const clientOptions: LanguageClientOptions = {
		documentSelector: LANGUAGES.flatMap((language) => [
			{ scheme: 'file', language },
			{ scheme: 'untitled', language }
		]),
		initializationOptions: { settings: editorSettings() }
	};
	const started = new LanguageClient('chartguard', 'ChartGuard', serverOptions, clientOptions);
	client = started;
	context.subscriptions.push(
		workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('chartguard'))
				void started.sendNotification('workspace/didChangeConfiguration', { settings: editorSettings() });
		}),
		commands.registerCommand('chartguard.restart', () => started.restart())
	);
	await started.start();
}

export async function deactivate(): Promise<void> {
	await client?.stop();
	client = undefined;
}
