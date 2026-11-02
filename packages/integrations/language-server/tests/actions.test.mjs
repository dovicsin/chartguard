import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { connect } from './client.mjs';

/** Code actions and settings (CG-06-04 part 2): the runtime's renames as quick fixes, drawing changes confirmed first. */
const uri = (name) => pathToFileURL(join(process.cwd(), name)).href;
const CHART = "import { Chart } from 'chart.js';\n";
const PIE =
	"import * as echarts from 'echarts';\necharts.init(el).setOption({ series: [{ type: 'pie', clockWise: false, data: [1] }] });";
const BARS = `${CHART}new Chart(ctx, { type: 'bar', data: { labels: ['a'], datasets: [{ label: 'S', data: [10] }] }, options: { scales: { y: { min: 5, title: { display: true, text: 'Count' } } } } });`;
const WHOLE = { start: { line: 0, character: 0 }, end: { line: 9, character: 0 } };

/** The text after applying the LSP text edits (on a single line, as these texts have it where they edit). */
function applied(text, edits) {
	const lines = text.split('\n');
	for (const { range, newText } of [...edits].sort((a, b) => b.range.start.character - a.range.start.character)) {
		const line = lines[range.start.line];
		lines[range.start.line] = `${line.slice(0, range.start.character)}${newText}${line.slice(range.end.character)}`;
	}
	return lines.join('\n');
}

test('a rename the runtime does itself is a preferred quick fix', async () => {
	const client = connect();
	await client.initialize();
	await client.open(uri('pie.js'), PIE);
	const { result } = await client.request('textDocument/codeAction', {
		textDocument: { uri: uri('pie.js') },
		range: WHOLE,
		context: { diagnostics: [] }
	});
	const [action] = result.filter(({ isPreferred }) => isPreferred);
	assert.equal(action.kind, 'quickfix');
	assert.equal(action.title, 'Rename as the runtime does: clockwise');
	assert.equal(action.diagnostics[0].code, 'config-warnings');
	assert.equal(applied(PIE, action.edit.changes[uri('pie.js')]), PIE.replace('clockWise', 'clockwise'));
});

const ASK = (name) => ({ textDocument: { uri: uri(name) }, range: WHOLE, context: { diagnostics: [] } });

test('an edit that changes the drawing is a quick fix never preferred', async () => {
	const client = connect();
	await client.initialize();
	await client.open(uri('bars.js'), BARS);
	const [suggested] = (await client.request('textDocument/codeAction', ASK('bars.js'))).result;
	assert.equal(suggested.isPreferred, false);
	assert.match(suggested.title, /^Set \$\.options\.scales\.y\.min to 0: The bars grow from zero again/u);
	assert.equal(applied(BARS, suggested.edit.changes[uri('bars.js')]), BARS.replace('min: 5', 'min: 0'));
});

test('where the client can, a drawing change asks for confirmation (a change annotation)', async () => {
	const client = connect();
	await client.initialize({
		capabilities: { workspace: { workspaceEdit: { documentChanges: true, changeAnnotationSupport: {} } } }
	});
	await client.open(uri('bars.js'), BARS);
	const [annotated] = (await client.request('textDocument/codeAction', ASK('bars.js'))).result;
	const [change] = annotated.edit.documentChanges;
	assert.deepEqual(change.textDocument, { uri: uri('bars.js'), version: 1 });
	assert.equal(change.edits[0].annotationId, 'chartguard.changes-drawing');
	assert.equal(annotated.edit.changeAnnotations['chartguard.changes-drawing'].needsConfirmation, true);
	assert.equal(applied(BARS, change.edits), BARS.replace('min: 5', 'min: 0'));
	// A client with document changes but no annotations gets plain changes.
	const plain = connect();
	await plain.initialize({ capabilities: { workspace: { workspaceEdit: { documentChanges: true } } } });
	await plain.open(uri('bars.js'), BARS);
	const [unannotated] = (await plain.request('textDocument/codeAction', ASK('bars.js'))).result;
	assert.equal(unannotated.edit.documentChanges, undefined);
});

test('code actions only for findings in the asked range', async () => {
	const client = connect();
	await client.initialize();
	await client.open(uri('pie.js'), PIE);
	const elsewhere = { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } };
	const { result } = await client.request('textDocument/codeAction', {
		textDocument: { uri: uri('pie.js') },
		range: elsewhere,
		context: { diagnostics: [] }
	});
	assert.deepEqual(result, []);
	const unknown = await client.request('textDocument/codeAction', {
		textDocument: { uri: uri('never-opened.js') },
		range: WHOLE,
		context: { diagnostics: [] }
	});
	assert.deepEqual(unknown.result, []);
});

test('settings: from initialization and every configuration change; unusable ones are said, and nothing is claimed', async () => {
	const wrong = `${CHART}new Chart(ctx, { type: 'bar', data: { datasets: [] }, options: { scales: { y: { min: 'x' } } } });`;
	const client = connect();
	await client.initialize({
		initializationOptions: { settings: { chartguard: { libraryVersion: { chartjs: '3.9.1' } } } }
	});
	const old = await client.open(uri('chart.js'), wrong);
	assert.deepEqual(
		old.params.diagnostics.map(({ code, message }) => [code, message.split(':')[0]]),
		[['config-warnings', 'CFG_UNSUPPORTED_VERSION $']]
	);
	client.notify('workspace/didChangeConfiguration', { settings: { chartguard: { libraryVersion: { chartjs: 4 } } } });
	const shown = await client.next('window/showMessage');
	assert.equal(shown.params.type, 1);
	assert.match(
		shown.params.message,
		/^ChartGuard: chartguard cannot be used:\n {2}chartguard\.libraryVersion\.chartjs: must be a version string/u
	);
	assert.deepEqual((await client.next('textDocument/publishDiagnostics')).params.diagnostics, []);
	client.notify('workspace/didChangeConfiguration', { settings: { chartguard: {} } });
	const fixed = await client.next('textDocument/publishDiagnostics');
	assert.deepEqual(
		fixed.params.diagnostics.map(({ code }) => code),
		['valid-config']
	);
});

test('a document in another language, or not a file, is handled by what it is', async () => {
	const client = connect();
	await client.initialize();
	const json = await client.open(uri('data.json'), '{ "type": "bar" }', 'json');
	assert.deepEqual(json.params.diagnostics, []);
	// Chart code in a document of another language is not read, whatever its name.
	const wrongText = `${CHART}new Chart(ctx, { type: 'bar', data: { datasets: [] }, options: { scales: { y: { min: 'x' } } } });`;
	const plain = await client.open(uri('notes.js'), wrongText, 'plaintext');
	assert.deepEqual(plain.params.diagnostics, []);
	const wrong = `${CHART}new Chart(ctx, { type: 'bar', data: { datasets: [] }, options: { scales: { y: { min: 'x' } } } });`;
	const untitled = await client.open('untitled:Untitled-1', wrong, 'typescript');
	assert.deepEqual(
		untitled.params.diagnostics.map(({ code }) => code),
		['valid-config']
	);
});

test('the title of a rename names the new key without its quotes', async () => {
	const quoted = PIE.replace('clockWise', "'clockWise'");
	const client = connect();
	await client.initialize();
	await client.open(uri('quoted.js'), quoted);
	const { result } = await client.request('textDocument/codeAction', ASK('quoted.js'));
	const [action] = result.filter(({ isPreferred }) => isPreferred);
	assert.equal(action.title, 'Rename as the runtime does: clockwise');
	assert.equal(applied(quoted, action.edit.changes[uri('quoted.js')]), quoted.replace("'clockWise'", "'clockwise'"));
});
