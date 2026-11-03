const assert = require('node:assert/strict');

const vscode = require('vscode');

/** A hang guard, never a time budget: what the editor shows arrives in seconds, or something is broken. */
const HANG_GUARD_MS = 60_000;

/** The ChartGuard diagnostics of `uri` once `ready` holds for them. */
function diagnosticsWhen(uri, ready) {
	const current = () => vscode.languages.getDiagnostics(uri).filter(({ source }) => source === 'ChartGuard');
	if (ready(current())) return Promise.resolve(current());
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			listener.dispose();
			reject(new Error(`no such diagnostics for ${uri.toString()}: ${JSON.stringify(current())}`));
		}, HANG_GUARD_MS);
		const listener = vscode.languages.onDidChangeDiagnostics(() => {
			if (!ready(current())) return;
			clearTimeout(timer);
			listener.dispose();
			resolve(current());
		});
	});
}

/** The kinds of the validator's findings; quality findings (advisory) are checked apart. */
const codes = (diagnostics) =>
	diagnostics
		.map(({ code }) => code)
		.filter((code) => code !== 'chart-quality')
		.sort();

/** Opens the workspace's chart and checks what the editor shows: each finding at its value, by its severity. */
async function shownProblems() {
	const [folder] = vscode.workspace.workspaceFolders;
	const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, 'chart.js'));
	await vscode.window.showTextDocument(document);
	const found = await diagnosticsWhen(document.uri, (list) => codes(list).length >= 2);
	assert.deepEqual(codes(found), ['config-warnings', 'valid-config']);
	const quality = found.filter(({ code }) => code === 'chart-quality');
	assert.ok(quality.length > 0);
	for (const { severity } of quality) assert.equal(severity, vscode.DiagnosticSeverity.Information);
	const wrong = found.find(({ code }) => code === 'valid-config');
	assert.equal(document.getText(wrong.range), "'x'");
	assert.equal(wrong.severity, vscode.DiagnosticSeverity.Error);
	return { document, found };
}

/** The runtime's own rename, as a quick fix the editor applies. */
async function quickFix(document, found) {
	const deprecated = found.find(({ code }) => code === 'config-warnings');
	const actions = await vscode.commands.executeCommand(
		'vscode.executeCodeActionProvider',
		document.uri,
		deprecated.range
	);
	const rename = actions.find(({ title }) => title === 'Rename as the runtime does: clockwise');
	assert.ok(rename, JSON.stringify(actions.map(({ title }) => title)));
	assert.equal(await vscode.workspace.applyEdit(rename.edit), true);
	assert.match(document.getText(), /clockwise: false/u);
	await diagnosticsWhen(document.uri, (list) => codes(list).join() === 'valid-config');
}

/** Settings from the editor: another major is not validated, only said. */
async function settingsApply(document) {
	const settings = vscode.workspace.getConfiguration('chartguard');
	await settings.update('libraryVersion', { chartjs: '3.9.1' }, vscode.ConfigurationTarget.Global);
	try {
		const old = await diagnosticsWhen(document.uri, (list) =>
			list.some(({ message }) => message.startsWith('CFG_UNSUPPORTED_VERSION'))
		);
		assert.deepEqual(codes(old), ['config-warnings']);
	} finally {
		await settings.update('libraryVersion', undefined, vscode.ConfigurationTarget.Global);
	}
}

/** Runs inside VS Code with the extension under development and `tests/vscode/workspace` open (CG-06-05). */
exports.run = async () => {
	const { document, found } = await shownProblems();
	await quickFix(document, found);
	await settingsApply(document);
};
