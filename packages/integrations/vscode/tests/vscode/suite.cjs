const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

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

/** A diagnostic's kind: VS Code holds a code with a link to its explanation as `{ value, target }`. */
const kindOf = ({ code }) => (typeof code === 'object' ? code.value : code);

/** The kinds of the validator's findings; quality findings (advisory) are checked apart. */
const codes = (diagnostics) =>
	diagnostics
		.map(kindOf)
		.filter((code) => code !== 'chart-quality')
		.sort();

/** Opens the workspace's chart and checks what the editor shows: each finding at its value, by its severity. */
async function shownProblems() {
	const [folder] = vscode.workspace.workspaceFolders;
	const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, 'chart.js'));
	await vscode.window.showTextDocument(document);
	const found = await diagnosticsWhen(document.uri, (list) => codes(list).length >= 2);
	assert.deepEqual(codes(found), ['config-warnings', 'valid-config']);
	const quality = found.filter((diagnostic) => kindOf(diagnostic) === 'chart-quality');
	assert.ok(quality.length > 0);
	for (const { severity } of quality) assert.equal(severity, vscode.DiagnosticSeverity.Information);
	const wrong = found.find((diagnostic) => kindOf(diagnostic) === 'valid-config');
	assert.equal(document.getText(wrong.range), "'x'");
	// The code links to where the finding is explained (CG-06-07).
	assert.equal(wrong.code.target.toString(true), 'https://dovicsin.github.io/chartguard/reference/codes.html#CFG_TYPE');
	assert.equal(wrong.severity, vscode.DiagnosticSeverity.Error);
	return { document, found };
}

/** How often a code action request the editor cancelled is asked again: a bound, never a wait. */
const CANCELLED_ATTEMPTS = 5;

/**
 * The code actions at `range`. VS Code cancels the request when the document's code action providers
 * change while it runs (`getCodeActions` cancels on the registry's `onDidChange`): an extension that
 * activates meanwhile, such as the built-in TypeScript one on a loaded machine. The editor then asks
 * again, and so does this; any other failure is the test's.
 */
async function codeActionsAt(uri, range) {
	for (let attempt = 1; ; attempt += 1) {
		try {
			return await vscode.commands.executeCommand('vscode.executeCodeActionProvider', uri, range);
		} catch (error) {
			const cancelled = error instanceof Error && error.message === 'Canceled';
			if (!cancelled || attempt >= CANCELLED_ATTEMPTS) throw error;
			console.log(`code actions: cancelled by the editor (attempt ${String(attempt)}), asked again`);
		}
	}
}

/**
 * The cancellation `codeActionsAt` answers, made to happen: a provider that, the first time it is
 * asked, registers another for the document, so the providers change while the request runs. VS Code
 * cancels that request (a plain one fails `Canceled`); asked again, the rename comes back.
 */
async function cancelledRequest(document, found) {
	const deprecated = found.find((diagnostic) => kindOf(diagnostic) === 'config-warnings');
	let late;
	const registrations = [];
	const changing = () =>
		vscode.languages.registerCodeActionsProvider('javascript', {
			provideCodeActions() {
				if (late === undefined) {
					late = vscode.languages.registerCodeActionsProvider('javascript', { provideCodeActions: () => [] });
					registrations.push(late);
				}
				return [];
			}
		});
	try {
		registrations.push(changing());
		await assert.rejects(
			vscode.commands.executeCommand('vscode.executeCodeActionProvider', document.uri, deprecated.range),
			/Canceled/u
		);
		late = undefined;
		const actions = await codeActionsAt(document.uri, deprecated.range);
		assert.ok(actions.some(({ title }) => title === 'Rename as the runtime does: clockwise'));
	} finally {
		for (const registration of registrations) registration.dispose();
	}
}

/** The runtime's own rename, as a quick fix the editor applies. */
async function quickFix(document, found) {
	const deprecated = found.find((diagnostic) => kindOf(diagnostic) === 'config-warnings');
	const actions = await codeActionsAt(document.uri, deprecated.range);
	const rename = actions.find(({ title }) => title === 'Rename as the runtime does: clockwise');
	assert.ok(rename, JSON.stringify(actions.map(({ title }) => title)));
	assert.equal(await vscode.workspace.applyEdit(rename.edit), true);
	assert.match(document.getText(), /clockwise: false/u);
	await diagnosticsWhen(document.uri, (list) => codes(list).join() === 'valid-config');
}

const hasError = (list) => codes(list).includes('valid-config');

/** Settings from the editor: another major is not validated, only said; restored, it is validated again. */
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
	// What follows starts from the diagnostics of the restored settings, never from those still on their way.
	await diagnosticsWhen(document.uri, hasError);
}

/** A module of the benchmarks (E77), imported into the extension host: one way of measuring, one set of budgets. */
const benchmarks = (name) =>
	import(pathToFileURL(join(__dirname, '..', '..', '..', '..', '..', 'tools', 'benchmarks', 'lib', name)).href);

/** The server's wait before it checks (200 ms, so typing does not check every key): a wait, not work. */
const SERVER_WAIT_MS = 200;

/** An edit that removes the wrong value or puts it back, until the editor shows what it changed. */
function toggleEdit(document) {
	let wrong = true;
	return async () => {
		const [from, to] = wrong ? ["min: 'x'", 'min: 1'] : ['min: 1', "min: 'x'"];
		const start = document.positionAt(document.getText().indexOf(from));
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, new vscode.Range(start, start.translate(0, from.length)), to);
		wrong = !wrong;
		const shown = diagnosticsWhen(document.uri, (list) => hasError(list) === wrong);
		assert.equal(await vscode.workspace.applyEdit(edit), true);
		await shown;
	};
}

/** `ChartGuard: Restart the language server`, until the new server's diagnostics are shown. */
async function restart(document) {
	const cleared = diagnosticsWhen(document.uri, (list) => !hasError(list));
	await vscode.commands.executeCommand('chartguard.restart');
	await cleared;
	await diagnosticsWhen(document.uri, hasError);
}

/**
 * What the user waits for in VS Code itself (CG-07-03, E77), in reference units against the budgets
 * of `EDITOR_BUDGETS`, an overrun measured again before it fails: an edit until its diagnostics are
 * shown, and a restart of the server (the bundled server starting, its first check) until they are
 * shown again. The server's fixed wait is left out of both.
 */
async function latency(document) {
	const [{ fastestAsync, judge, reference }, { EDITOR_BUDGETS }] = await Promise.all([
		benchmarks('measure.mjs'),
		benchmarks('budgets.mjs')
	]);
	const toggle = toggleEdit(document);
	const measures = { 'vscode-edit': toggle, 'vscode-restart': () => restart(document) };
	assert.deepEqual(Object.keys(measures).sort(), Object.keys(EDITOR_BUDGETS).sort());
	for (const [id, body] of Object.entries(measures)) {
		// Each measurement starts with the wrong value in place: an odd number of edits removed it.
		if (!hasError(await diagnosticsWhen(document.uri, () => true))) await toggle();
		const { budget } = EDITOR_BUDGETS[id];
		const measure = async ({ runs }) => {
			const [time, unit] = await fastestAsync([body, async () => reference()], runs);
			return (time - SERVER_WAIT_MS) / unit;
		};
		const { value, within } = await judge(measure, budget);
		console.log(`${id} ${value.toFixed(2)} units  budget ${String(budget)} units  ${within ? 'ok' : 'OVER'}`);
		assert.ok(within, `${id}: ${value.toFixed(2)} units against a budget of ${String(budget)}`);
	}
}

/** Runs `check`, naming the step in its error: the editor's own log does not say where a run stopped. */
async function step(name, check) {
	try {
		return await check();
	} catch (error) {
		throw new Error(`step "${name}": ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	}
}

/** Runs inside VS Code with the extension under development and `tests/vscode/workspace` open (CG-06-05). */
exports.run = async () => {
	const { document, found } = await step('shown problems', shownProblems);
	await step('cancelled request', () => cancelledRequest(document, found));
	await step('quick fix', () => quickFix(document, found));
	await step('settings', () => settingsApply(document));
	await step('latency', () => latency(document));
};
