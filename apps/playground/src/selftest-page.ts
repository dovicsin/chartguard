import type { Example } from './examples.js';
import type { Library, LibraryId } from './libraries.js';
import type { Verdict } from './runtime.js';
import { compare, type SelfTestEntry } from './selftest.js';
import { readShared, shareFragment } from './share.js';
import { type Mode, MODES } from './tools.js';

/** What the self-test drives: the page's own functions, so it takes the paths a user's clicks take. */
export interface Page {
	readonly libraries: readonly Library[];
	readonly examples: readonly Example[];
	/** Loads a library in an input mode and shows its first example. */
	select(id: LibraryId, mode: Mode): Promise<void>;
	showExample(id: string): void;
	/** The validator findings (`severity code path`) and the runtime verdict the page shows now. */
	shown(): { readonly findings: string[]; readonly runtime: Verdict | undefined };
	/** Every finding the page shows (validator and quality, `code path`), each with its fix button if offered. */
	/** The findings (`code path`) the engine offers a fix for. */
	fixable(): readonly string[];
	offers(): readonly { readonly finding: string; readonly apply: (() => void) | undefined }[];
	stray(): number | undefined;
	/** Charts the runtimes not drawing now still hold. */
	leftover(): number;
	library(): string;
	mode(): Mode;
	example(): string;
	notice(): string | null;
	/** The note under the runtime's verdict, or '' when there is none. */
	runtimeNote(): string;
	/** Settles when the link the page is opening has been shown. */
	opening(): Promise<void>;
	text(): string;
	/** Whether "Undo fix" is offered. */
	canUndo(): boolean;
	/** An `input` event on the editor, as typing sends. */
	typed(): void;
	undo(): void;
}

/**
 * Resolves after the timers a draw started have run (Chart.js updates a chart it has just attached
 * once more from a timer): an order of events, never a time limit. Headless Chrome with virtual
 * time renders no frames, so nothing here waits for one.
 */
const settled = (): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, 0);
	});

/** Every error the page does not catch from now on, in order: the self-test takes them per example. */
function uncaughtErrors(): string[] {
	const errors: string[] = [];
	window.addEventListener('error', (event) => {
		errors.push(event.message);
	});
	window.addEventListener('unhandledrejection', (event) => {
		errors.push(String(event.reason));
	});
	return errors;
}

/** A fix button for exactly the findings the engine offers a fix for (in code-unit order: the page lists validator findings by severity). */
function buttonProblems(page: Page): string[] {
	const buttons = page
		.offers()
		.filter(({ apply }) => apply !== undefined)
		.map(({ finding }) => finding)
		.sort();
	const fixable = [...page.fixable()].sort();
	return buttons.join('\n') === fixable.join('\n')
		? []
		: [`fix buttons ${JSON.stringify(buttons)} != fixes ${JSON.stringify(fixable)}`];
}

/** One fix applied and undone: its finding gone, then the text back, nothing left to undo, no chart left behind. */
async function oneFix(page: Page, finding: string, apply: () => void): Promise<string[]> {
	const original = page.text();
	const problems: string[] = [];
	apply();
	await settled();
	if (page.offers().some((after) => after.finding === finding)) problems.push(`fix kept its finding: ${finding}`);
	if (!page.canUndo()) problems.push(`no undo after: ${finding}`);
	page.undo();
	await settled();
	if (page.text() !== original) problems.push(`undo did not restore the text after: ${finding}`);
	if (page.canUndo()) problems.push(`undo still offered with nothing to undo after: ${finding}`);
	if ((page.stray() ?? 0) > 0) problems.push(`the runtime holds charts the page does not show after: ${finding}`);
	return problems;
}

/** Applies each offered fix in turn, by its button. */
async function fixProblems(page: Page): Promise<string[]> {
	const problems = buttonProblems(page);
	const count = page.offers().length;
	for (let index = 0; index < count; index++) {
		const { finding, apply } = page.offers()[index] ?? { finding: '', apply: undefined };
		if (apply !== undefined) problems.push(...(await oneFix(page, finding, apply)));
	}
	return [...problems, ...(await typedProblems(page))];
}

/** Typing after a fix drops its undo: an undo would discard what was typed. */
async function typedProblems(page: Page): Promise<string[]> {
	const apply = page.offers().find((offer) => offer.apply !== undefined)?.apply;
	if (apply === undefined) return [];
	apply();
	page.typed();
	await settled();
	return page.canUndo() ? ['undo still offered after typing'] : [];
}

/** The example's text shared and read back in this browser. */
function shareProblems(page: Page, library: string): string[] {
	const fragment = shareFragment({ library, mode: page.mode() }, page.text());
	if (typeof fragment !== 'string') return [`not shareable: ${fragment.reason}`];
	const shared = readShared(fragment, { libraries: [library], modes: MODES });
	return shared?.ok === true && shared.text === page.text() ? [] : ['the shared link does not read back'];
}

/** Navigates to `fragment` as a pasted link does (no reload) and waits until the page has opened it. */
async function navigate(page: Page, fragment: string): Promise<void> {
	const changed = new Promise<void>((resolve) => {
		window.addEventListener(
			'hashchange',
			() => {
				resolve();
			},
			{ once: true }
		);
	});
	location.hash = fragment;
	await changed;
	await page.opening();
}

/** Links opened in a tab that shows the page: a shared config, and one that cannot be read. */
async function linkProblems(page: Page): Promise<string[]> {
	const problems: string[] = [];
	await navigate(page, 'library=chartjs&config=AAAA');
	const notice = page.notice() ?? '';
	if (!notice.startsWith('The shared link could not be read'))
		problems.push(`no reason for a broken link: "${notice}"`);
	const text = 'const options: object = {};';
	const fragment = shareFragment({ library: 'echarts', mode: 'typescript' }, text);
	await navigate(page, typeof fragment === 'string' ? fragment : '');
	if (page.library() !== 'echarts' || page.mode() !== 'typescript' || page.text() !== text)
		problems.push('a shared link did not open its text in its library and input');
	if (page.example() !== '') problems.push(`a shared text shows example "${page.example()}"`);
	if (page.notice() !== '') problems.push(`a link that opened keeps the notice "${page.notice() ?? ''}"`);
	return problems;
}

/**
 * An example shown again in the same page: ECharts printed its warning the first time and stays
 * silent now, so its verdict carries the note; a Chart.js chart, whose runtime prints every time, none.
 */
async function repeatProblems(page: Page): Promise<string[]> {
	const problems: string[] = [];
	await page.select('echarts', 'json');
	page.showExample('echarts:contract:pie-clockwise');
	await settled();
	if (!page.runtimeNote().startsWith('This runtime prints some messages only once'))
		problems.push(`no note on a verdict ECharts may miss messages in: "${page.runtimeNote()}"`);
	await page.select('chartjs', 'json');
	if (page.runtimeNote() !== '') problems.push(`a note on a Chart.js verdict: "${page.runtimeNote()}"`);
	if (page.leftover() > 0)
		problems.push(`ECharts holds ${String(page.leftover())} chart(s) after a switch to Chart.js`);
	return problems;
}

/** The checks of the page itself, after the examples: links opened in place, an example shown again. */
async function pageEntries(page: Page): Promise<SelfTestEntry[]> {
	const entry = (id: string, problems: string[]): SelfTestEntry => ({
		id,
		findings: [],
		runtime: undefined,
		uncaught: [],
		stray: undefined,
		problems
	});
	return [entry('links', await linkProblems(page)), entry('repeat', await repeatProblems(page))];
}

/**
 * Right after a library is selected: the first chart a runtime draws in a page can have missed nothing
 * it printed before (no note), and the runtime drawn before holds no chart any more (E51).
 */
function switchProblems(page: Page, library: string): string[] {
	const problems =
		page.runtimeNote() === '' ? [] : [`a note on the first chart of ${library}: "${page.runtimeNote()}"`];
	if (page.leftover() > 0)
		problems.push(`switching to ${library} left ${String(page.leftover())} chart(s) in another runtime`);
	return problems;
}

/**
 * One example shown, compared with its pins, its fixes applied, shared; `uncaught` is emptied into it.
 * In source mode the page lists the editors' claims (E56): the pinned info findings are no claim.
 */
async function exampleEntry(page: Page, example: Example, uncaught: string[]): Promise<SelfTestEntry> {
	page.showExample(example.id);
	await settled();
	const observed = { ...page.shown(), uncaught: uncaught.splice(0), stray: page.stray() };
	const more = [...(await fixProblems(page)), ...shareProblems(page, example.library)];
	const late = uncaught.splice(0).map((error) => `uncaught error: ${error}`);
	const mode = page.mode();
	const problems = [...compare(example, observed, { claimsOnly: mode !== 'json' }), ...more, ...late];
	return { id: mode === 'json' ? example.id : `${mode}:${example.id}`, ...observed, problems };
}

/**
 * `?selftest` (`=javascript` for source input): show every example in turn and compare what the page
 * shows with what the fixtures pin, and every error the page left uncaught while it showed it; apply
 * every fix it offers and undo it; share it; in the JSON run, then open links as a pasted one opens
 * (entry `links`). One input mode per page load: ECharts logs a message once per page (E28), so an
 * example shown twice in one page would show its runtime's warning only the first time. The JSON
 * report lands in `#selftest` for apps/playground/tests/browser.test.mjs.
 */
export async function selfTest(page: Page, mode: Mode): Promise<void> {
	const uncaught = uncaughtErrors();
	const report: SelfTestEntry[] = [];
	for (const library of page.libraries) {
		await page.select(library.id, mode);
		const first = switchProblems(page, library.id);
		for (const example of page.examples.filter((candidate) => candidate.library === library.id)) {
			const entry = await exampleEntry(page, example, uncaught);
			report.push({ ...entry, problems: [...first.splice(0), ...entry.problems] });
		}
	}
	if (mode === 'json') report.push(...(await pageEntries(page)));
	const output = document.createElement('pre');
	output.id = 'selftest';
	output.textContent = JSON.stringify(report);
	document.body.append(output);
}
