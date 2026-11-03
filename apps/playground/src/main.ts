import { type Diagnostic, locateJsonPath, type ValidationStatus } from '@chartguard/core';

import { EditorText } from './editor.js';
import { offerOf } from './edits.js';
import { type Example, exampleChoices, formatJson } from './examples.js';
import { LIBRARIES, type Library, libraryById } from './libraries.js';
import {
	type Adapter,
	bySeverity,
	countBySeverity,
	fixableFindings,
	inspect,
	type Inspection,
	lineAndColumn,
	schemaLabel
} from './model.js';
import { observe, type Renderer, type RuntimeOutcome } from './runtime.js';
import { selfTest } from './selftest-page.js';
import {
	badge,
	choiceNodes,
	diagnosticItems,
	expectationNodes,
	messageItems,
	type OfferFor,
	shownOffers
} from './view.js';

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
	share: byId('share', HTMLButtonElement),
	notice: byId('notice', HTMLParagraphElement),
	editor: byId('editor', HTMLTextAreaElement),
	undo: byId('undo', HTMLButtonElement),
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
/** The last link being opened (the first load, or a fragment that changed). */
let opening: Promise<void> = Promise.resolve();
const editor = new EditorText(ui.editor, ui.undo, update);

/** Selects the text of the value a diagnostic points at and scrolls it into view. */
function reveal(path: string): void {
	if (inspection?.kind !== 'checked') return;
	const span = locateJsonPath(inspection.tree, path);
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

/** The fix button of each finding whose fix verifies against the text that was checked. */
const offersOf =
	(checked: Extract<Inspection, { kind: 'checked' }>): OfferFor =>
	(diagnostic: Diagnostic) => {
		const offer = offerOf(checked, diagnostic);
		if (offer === undefined) return undefined;
		const apply = (): void => {
			editor.apply(offer.edit);
		};
		return offer.note === undefined ? { label: offer.label, apply } : { label: offer.label, note: offer.note, apply };
	};

function showChecked(current: Active, checked: Extract<Inspection, { kind: 'checked' }>): void {
	const { validation, quality } = checked;
	const counts = countBySeverity(validation.diagnostics);
	const offers = offersOf(checked);
	ui.syntax.textContent = '';
	ui.validator.replaceChildren(badge(validation.status, STATUS_TONE[validation.status]));
	ui.schema.textContent = `schema ${schemaLabel(validation)} · coverage ${validation.coverage}`;
	ui.summary.textContent = `${String(counts.error)} error(s), ${String(counts.warning)} warning(s), ${String(counts.info)} info`;
	ui.diagnostics.replaceChildren(
		...diagnosticItems(bySeverity(validation.diagnostics), reveal, 'No findings.', offers)
	);
	ui.quality.replaceChildren(...diagnosticItems(quality.diagnostics, reveal, 'No advisory findings.', offers));
	showRuntime(preview(current, checked.config), 'no preview');
}

function update(): void {
	if (active === undefined) return;
	inspection = inspect(editor.value, active.adapter);
	if (inspection.kind === 'syntax-error') showSyntaxError(inspection.message, inspection.offset);
	else showChecked(active, inspection);
}

/** Shows a text that is no example (a shared link): no pinned outcome, no example selected. */
function showText(text: string): void {
	ui.expected.replaceChildren();
	ui.expected.hidden = true;
	ui.example.value = '';
	editor.set(text);
	update();
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
	editor.set(formatJson(example.config));
	update();
}

interface Start {
	readonly example?: string;
	readonly text?: string;
}

function showStart(own: readonly Example[], start: Start): void {
	if (start.text === undefined) showExample(start.example ?? own[0]?.id ?? '');
	else showText(start.text);
}

/** Loads a library and shows `start`: an example by id, a shared text, or the library's first example. */
async function selectLibrary(id: string, start: Start = {}): Promise<void> {
	const library = libraryById(id) ?? LIBRARIES[0];
	if (library === undefined) return;
	ui.library.value = library.id;
	ui.validator.replaceChildren(badge('loading…', 'muted'));
	active?.renderer?.dispose();
	const [adapter, renderer] = await Promise.all([library.adapter(), library.renderer?.()]);
	active = { library, adapter, renderer };
	const own = examples.filter((example) => example.library === library.id);
	ui.example.replaceChildren(...choiceNodes(exampleChoices(own)));
	showStart(own, start);
}

/** Puts the editor text into the URL fragment and copies the link, when the browser lets the page. */
async function share(): Promise<void> {
	if (active === undefined) return;
	const { shareFragment } = await import('./share.js');
	const fragment = shareFragment(active.library.id, editor.value);
	if (typeof fragment !== 'string') {
		ui.notice.textContent = `Cannot share: ${fragment.reason}.`;
		return;
	}
	history.replaceState(null, '', `#${fragment}`);
	try {
		await navigator.clipboard.writeText(location.href);
		ui.notice.textContent = 'Link copied.';
	} catch {
		ui.notice.textContent = 'The link is in the address bar.';
	}
}

/** The page as the self-test drives it. */
const page = {
	libraries: LIBRARIES,
	get examples() {
		return examples;
	},
	selectLibrary: (id: string) => selectLibrary(id),
	showExample,
	shown() {
		const diagnostics = inspection?.kind === 'checked' ? inspection.validation.diagnostics : [];
		return { findings: diagnostics.map((d) => `${d.severity} ${d.code} ${d.path}`), runtime: lastOutcome?.verdict };
	},
	fixable: () => (inspection?.kind === 'checked' ? fixableFindings(inspection) : []),
	offers: () => shownOffers(ui.diagnostics, ui.quality),
	stray: () => active?.renderer?.stray(),
	library: () => ui.library.value,
	example: () => ui.example.value,
	notice: () => ui.notice.textContent,
	opening: () => opening,
	text: () => editor.value,
	canUndo: () => !ui.undo.hidden,
	typed: () => {
		ui.editor.dispatchEvent(new Event('input'));
	},
	undo: () => {
		editor.undo();
	}
};

/** A shared config from the fragment, an example id, or the first example; a link that cannot be read says why. */
async function open(): Promise<void> {
	const fragment = location.hash.slice(1);
	ui.notice.textContent = '';
	// The deflate code is loaded only for a link that shares a config.
	const shared = new URLSearchParams(fragment).has('config')
		? (await import('./share.js')).readShared(
				fragment,
				LIBRARIES.map(({ id }) => id)
			)
		: undefined;
	if (shared?.ok === true) {
		await selectLibrary(shared.library, { text: shared.text });
		return;
	}
	if (shared !== undefined) ui.notice.textContent = `The shared link could not be read: ${shared.reason}.`;
	const linked = examples.find(({ id }) => id === decodeURIComponent(fragment));
	await selectLibrary(linked?.library ?? ui.library.value, linked === undefined ? {} : { example: linked.id });
}

async function boot(): Promise<void> {
	examples = (await (await fetch('./examples.json')).json()) as Example[];
	ui.library.replaceChildren(...choiceNodes(LIBRARIES.map(({ id, label }) => ({ value: id, label }))));
	ui.library.addEventListener('change', () => void selectLibrary(ui.library.value));
	ui.example.addEventListener('change', () => {
		showExample(ui.example.value);
	});
	ui.share.addEventListener('click', () => void share());
	ui.editor.addEventListener('input', () => {
		editor.typed();
		clearTimeout(timer);
		timer = setTimeout(update, INPUT_DELAY_MS);
	});
	// A link opened in a tab that already shows the playground changes the fragment only, without a
	// reload; the page's own `replaceState` fires no `hashchange`.
	window.addEventListener('hashchange', () => {
		opening = open();
	});
	if (new URLSearchParams(location.search).has('selftest')) {
		await selfTest(page);
		return;
	}
	opening = open();
	await opening;
}

void boot();
