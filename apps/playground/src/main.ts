import { EditorText } from './editor.js';
import { type Example, exampleChoices, formatJson } from './examples.js';
import { LIBRARIES, type Library, libraryById, type LibraryId } from './libraries.js';
import { inspect, lineAndColumn } from './model.js';
import { Preview } from './preview.js';
import type { RuntimeOutcome } from './runtime.js';
import { selfTest } from './selftest-page.js';
import { type Shown, shownJson } from './shown.js';
import { sourceOf } from './source.js';
import { type Mode, MODES, Tools } from './tools.js';
import { ui } from './ui.js';
import {
	badge,
	choiceNodes,
	expectationNodes,
	findingItems,
	type ItemActions,
	messageItems,
	shownOffers
} from './view.js';

const INPUT_DELAY_MS = 250;
const FALLBACK_LINE_HEIGHT = 18;
const HINTS: Readonly<Record<Mode, string>> = {
	json: 'JSON, validated as you type',
	javascript: 'JavaScript, read without running it',
	typescript: 'TypeScript, read without running it'
};

let examples: readonly Example[] = [];
let library: Library | undefined;
let mode: Mode = 'json';
let shown: Shown | undefined;
let lastOutcome: RuntimeOutcome | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
/** The last link being opened (the first load, or a fragment that changed). */
let opening: Promise<void> = Promise.resolve();
const tools = new Tools();
const preview = new Preview(ui.preview);
const editor = new EditorText(ui.editor, ui.undo, update);

/** Selects the text a finding is about and scrolls it into view. */
function reveal({ start, end }: { readonly start: number; readonly end: number }): void {
	const { line } = lineAndColumn(ui.editor.value, start);
	const measured = Number.parseFloat(getComputedStyle(ui.editor).lineHeight);
	const lineHeight = Number.isFinite(measured) ? measured : FALLBACK_LINE_HEIGHT;
	ui.editor.focus();
	ui.editor.setSelectionRange(start, end);
	ui.editor.scrollTop = Math.max(0, (line - 4) * lineHeight);
}

function showRuntime(outcome: RuntimeOutcome | undefined, absent: string): void {
	lastOutcome = outcome;
	ui.runtime.replaceChildren(badge(outcome?.verdict ?? absent, outcome?.verdict ?? 'muted'));
	ui.messages.replaceChildren(...messageItems(outcome?.messages ?? []));
	ui.messages.hidden = (outcome?.messages.length ?? 0) === 0;
	showNote(outcome === undefined ? undefined : preview.note());
}

/** Why the verdict may miss messages, under it (a runtime that prints some only once in a page). */
function showNote(note: string | undefined): void {
	ui.runtimeNote.textContent = note ?? '';
	ui.runtimeNote.hidden = note === undefined;
}

const actions: ItemActions = {
	select: (item) => {
		reveal(item.range);
	},
	apply: (offer) => {
		editor.apply(offer.edit);
	}
};

function render(view: Shown): void {
	shown = view;
	ui.syntax.textContent = view.syntax;
	ui.validator.replaceChildren(badge(view.verdict.text, view.verdict.tone));
	ui.schema.textContent = view.schema;
	ui.summary.textContent = view.summary;
	ui.diagnostics.replaceChildren(...findingItems(view.validator, actions, 'No findings.'));
	ui.quality.replaceChildren(...findingItems(view.quality, actions, 'No advisory findings.'));
	const target = view.draw.kind === 'config' ? libraryById(view.draw.library) : undefined;
	const outcome = preview.show(
		view.draw,
		target === undefined ? undefined : tools.renderer(target.id),
		target?.noPreview ?? ''
	);
	showRuntime(outcome, view.draw.kind === 'none' ? 'not run' : 'no preview');
}

function update(): void {
	if (library === undefined) return;
	if (mode === 'json') {
		const adapter = tools.adapter(library.id);
		if (adapter !== undefined) render(shownJson(editor.value, inspect(editor.value, adapter), library.id));
		return;
	}
	const source = tools.source(editor.value, mode, ui.chart.value === '' ? 0 : Number(ui.chart.value));
	if (source === undefined) return;
	ui.chart.replaceChildren(...choiceNodes(source.charts));
	ui.chart.value = String(source.chart);
	ui.chartField.hidden = source.charts.length < 2;
	render(source.shown);
}

/** Shows a text that is no example (a shared link): no pinned outcome, no example selected. */
function showText(text: string): void {
	ui.expected.replaceChildren();
	ui.expected.hidden = true;
	ui.example.value = '';
	ui.chart.value = '0';
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
	ui.chart.value = '0';
	history.replaceState(null, '', `#${encodeURIComponent(example.id)}`);
	editor.set(mode === 'json' ? formatJson(example.config) : sourceOf(example));
	update();
}

interface Start {
	readonly example?: string;
	readonly text?: string;
}

/** Loads a library (and in source mode the analysis and every library) and shows `start`. */
async function select(id: string, next: Mode, start: Start = {}): Promise<void> {
	const chosen = libraryById(id) ?? LIBRARIES[0];
	if (chosen === undefined) return;
	ui.library.value = chosen.id;
	ui.mode.value = next;
	ui.hint.textContent = HINTS[next];
	ui.validator.replaceChildren(badge('loading…', 'muted'));
	await tools.load(next === 'json' ? [chosen] : LIBRARIES, next !== 'json');
	[library, mode] = [chosen, next];
	ui.chartField.hidden = true;
	const own = examples.filter((example) => example.library === chosen.id);
	ui.example.replaceChildren(...choiceNodes(exampleChoices(own)));
	if (start.text === undefined) showExample(start.example ?? own[0]?.id ?? '');
	else showText(start.text);
}

/** Another input mode: the example shown is shown in it, a text of the user's is kept. */
async function selectMode(next: Mode): Promise<void> {
	const example = ui.example.value;
	const text = example === '' ? editor.value : undefined;
	await select(library?.id ?? '', next, text === undefined ? { example } : { text });
}

/** Puts the editor text into the URL fragment and copies the link, when the browser lets the page. */
async function share(): Promise<void> {
	if (library === undefined) return;
	const { shareFragment } = await import('./share.js');
	const fragment = shareFragment({ library: library.id, mode }, editor.value);
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
	select: (id: LibraryId, next: Mode) => select(id, next),
	showExample,
	shown() {
		const items = shown?.validator ?? [];
		return { findings: items.map((d) => `${d.severity} ${d.code} ${d.path}`), runtime: lastOutcome?.verdict };
	},
	fixable: () => shown?.fixable ?? [],
	offers: () => shownOffers(ui.diagnostics, ui.quality),
	stray: () => preview.stray(),
	leftover: () => preview.leftover(),
	library: () => ui.library.value,
	mode: () => mode,
	example: () => ui.example.value,
	notice: () => ui.notice.textContent,
	runtimeNote: () => (ui.runtimeNote.hidden ? '' : ui.runtimeNote.textContent),
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
		? (await import('./share.js')).readShared(fragment, { libraries: LIBRARIES.map(({ id }) => id), modes: MODES })
		: undefined;
	if (shared?.ok === true) {
		await select(shared.library, shared.mode as Mode, { text: shared.text });
		return;
	}
	if (shared !== undefined) ui.notice.textContent = `The shared link could not be read: ${shared.reason}.`;
	const linked = examples.find(({ id }) => id === decodeURIComponent(fragment));
	await select(linked?.library ?? ui.library.value, mode, linked === undefined ? {} : { example: linked.id });
}

function listen(): void {
	ui.library.addEventListener('change', () => void select(ui.library.value, mode));
	ui.mode.addEventListener('change', () => void selectMode(ui.mode.value as Mode));
	ui.example.addEventListener('change', () => {
		showExample(ui.example.value);
	});
	ui.chart.addEventListener('change', update);
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
}

async function boot(): Promise<void> {
	examples = (await (await fetch('./examples.json')).json()) as Example[];
	ui.library.replaceChildren(...choiceNodes(LIBRARIES.map(({ id, label }) => ({ value: id, label }))));
	listen();
	const selftest = new URLSearchParams(location.search).get('selftest');
	if (selftest !== null) {
		await selfTest(page, MODES.find((candidate) => candidate === selftest) ?? 'json');
		return;
	}
	opening = open();
	await opening;
}

void boot();
