import type { ValidationStatus } from '@chartguard/core';

import { type Example, formatJson } from './examples.js';
import { LIBRARIES, type Library, libraryById } from './libraries.js';
import { locate } from './locate.js';
import {
	type Adapter,
	bySeverity,
	countBySeverity,
	inspect,
	type Inspection,
	lineAndColumn,
	schemaLabel
} from './model.js';
import { observe, type Renderer, type RuntimeOutcome } from './runtime.js';
import { compare, type SelfTestEntry } from './selftest.js';
import { badge, choiceNodes, diagnosticItems, expectationNodes, messageItems } from './view.js';

const INPUT_DELAY_MS = 250;
const FALLBACK_LINE_HEIGHT = 18;
const STATUS_TONE: Readonly<Record<ValidationStatus, string>> = { valid: 'ok', partial: 'partial', invalid: 'error' };

/** The element with `id`, checked to be of the expected kind: the markup is static, a mismatch is a bug. */
function byId<T extends HTMLElement>(id: string, kind: new () => T): T {
	const found = document.getElementById(id);
	if (!(found instanceof kind)) throw new Error(`playground markup: #${id} is missing or not a ${kind.name}`);
	return found;
}

const ui = {
	library: byId('library', HTMLSelectElement),
	example: byId('example', HTMLSelectElement),
	editor: byId('editor', HTMLTextAreaElement),
	syntax: byId('syntax', HTMLParagraphElement),
	validator: byId('validator-verdict', HTMLSpanElement),
	runtime: byId('runtime-verdict', HTMLSpanElement),
	schema: byId('schema', HTMLSpanElement),
	preview: byId('preview', HTMLDivElement),
	messages: byId('runtime-messages', HTMLUListElement),
	summary: byId('summary', HTMLParagraphElement),
	diagnostics: byId('diagnostics', HTMLOListElement),
	quality: byId('quality', HTMLOListElement),
	expected: byId('expected', HTMLElement)
};

interface Active {
	readonly library: Library;
	readonly adapter: Adapter;
	readonly renderer: Renderer | undefined;
}

let examples: readonly Example[] = [];
let active: Active | undefined;
let inspection: Inspection | undefined;
let lastOutcome: RuntimeOutcome | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Selects the text of the value a diagnostic points at and scrolls it into view. */
function reveal(path: string): void {
	if (inspection?.kind !== 'checked') return;
	const span = locate(inspection.tree, path);
	const { line } = lineAndColumn(ui.editor.value, span.start);
	const measured = Number.parseFloat(getComputedStyle(ui.editor).lineHeight);
	const lineHeight = Number.isFinite(measured) ? measured : FALLBACK_LINE_HEIGHT;
	ui.editor.focus();
	ui.editor.setSelectionRange(span.start, span.end);
	ui.editor.scrollTop = Math.max(0, (line - 4) * lineHeight);
}

function showRuntime(outcome: RuntimeOutcome | undefined, absent: string): void {
	lastOutcome = outcome;
	ui.runtime.replaceChildren(badge(outcome?.verdict ?? absent, outcome?.verdict ?? 'muted'));
	ui.messages.replaceChildren(...messageItems(outcome?.messages ?? []));
	ui.messages.hidden = (outcome?.messages.length ?? 0) === 0;
}

function preview(current: Active, config: unknown): RuntimeOutcome | undefined {
	const { renderer, library } = current;
	if (renderer === undefined) {
		ui.preview.textContent = library.noPreview ?? 'No preview.';
		return undefined;
	}
	return observe(() => {
		renderer.render(ui.preview, config);
	});
}

function showSyntaxError(message: string, offset: number): void {
	const { line, column } = lineAndColumn(ui.editor.value, offset);
	ui.syntax.textContent = `${message} (line ${String(line)}, column ${String(column)})`;
	ui.validator.replaceChildren(badge('not JSON', 'error'));
	active?.renderer?.dispose();
	ui.preview.replaceChildren();
	showRuntime(undefined, 'not run');
}

function showChecked(current: Active, checked: Extract<Inspection, { kind: 'checked' }>): void {
	const { validation, quality } = checked;
	const counts = countBySeverity(validation.diagnostics);
	ui.syntax.textContent = '';
	ui.validator.replaceChildren(badge(validation.status, STATUS_TONE[validation.status]));
	ui.schema.textContent = `schema ${schemaLabel(validation)} · coverage ${validation.coverage}`;
	ui.summary.textContent = `${String(counts.error)} error(s), ${String(counts.warning)} warning(s), ${String(counts.info)} info`;
	ui.diagnostics.replaceChildren(...diagnosticItems(bySeverity(validation.diagnostics), reveal, 'No findings.'));
	ui.quality.replaceChildren(...diagnosticItems(quality.diagnostics, reveal, 'No advisory findings.'));
	showRuntime(preview(current, checked.config), 'no preview');
}

function update(): void {
	if (active === undefined) return;
	inspection = inspect(ui.editor.value, active.adapter);
	if (inspection.kind === 'syntax-error') showSyntaxError(inspection.message, inspection.offset);
	else showChecked(active, inspection);
}

/** The example id is kept in the URL fragment, so a case can be linked: `#echarts:contract:axis-type-typo`. */
function showExample(id: string): void {
	const example = examples.find((candidate) => candidate.id === id);
	const pinned = expectationNodes(example);
	ui.expected.replaceChildren(...pinned);
	ui.expected.hidden = pinned.length === 0;
	if (example === undefined) return;
	ui.example.value = example.id;
	history.replaceState(null, '', `#${encodeURIComponent(example.id)}`);
	ui.editor.value = formatJson(example.config);
	update();
}

async function selectLibrary(id: string, exampleId?: string): Promise<void> {
	const library = libraryById(id) ?? LIBRARIES[0];
	if (library === undefined) return;
	ui.library.value = library.id;
	ui.validator.replaceChildren(badge('loading…', 'muted'));
	active?.renderer?.dispose();
	const [adapter, renderer] = await Promise.all([library.adapter(), library.renderer?.()]);
	active = { library, adapter, renderer };
	const own = examples.filter((example) => example.library === library.id);
	const choices = own.map(({ id: value, title, group }) => ({
		value,
		label: title,
		group: group === 'valid' ? 'Known valid' : 'Conformance contract'
	}));
	ui.example.replaceChildren(...choiceNodes(choices));
	showExample(exampleId ?? own[0]?.id ?? '');
}

/**
 * `?selftest`: show every example in turn and compare what the page shows with what the fixtures
 * pin; the JSON report lands in `#selftest` for apps/playground/tests/browser.test.mjs.
 */
async function selfTest(): Promise<void> {
	const report: SelfTestEntry[] = [];
	for (const library of LIBRARIES) {
		await selectLibrary(library.id);
		for (const example of examples.filter((candidate) => candidate.library === library.id)) {
			showExample(example.id);
			const diagnostics = inspection?.kind === 'checked' ? inspection.validation.diagnostics : [];
			const findings = diagnostics.map((d) => `${d.severity} ${d.code} ${d.path}`);
			const observed = { findings, runtime: lastOutcome?.verdict };
			report.push({ id: example.id, ...observed, problems: compare(example, observed) });
		}
	}
	const output = document.createElement('pre');
	output.id = 'selftest';
	output.textContent = JSON.stringify(report);
	document.body.append(output);
}

async function boot(): Promise<void> {
	examples = (await (await fetch('./examples.json')).json()) as Example[];
	ui.library.replaceChildren(...choiceNodes(LIBRARIES.map(({ id, label }) => ({ value: id, label }))));
	ui.library.addEventListener('change', () => void selectLibrary(ui.library.value));
	ui.example.addEventListener('change', () => {
		showExample(ui.example.value);
	});
	ui.editor.addEventListener('input', () => {
		clearTimeout(timer);
		timer = setTimeout(update, INPUT_DELAY_MS);
	});
	if (new URLSearchParams(location.search).has('selftest')) {
		await selfTest();
		return;
	}
	const linked = examples.find(({ id }) => id === decodeURIComponent(location.hash.slice(1)));
	await selectLibrary(linked?.library ?? ui.library.value, linked?.id);
}

void boot();
