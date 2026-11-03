import type { Example } from './examples.js';
import type { Library } from './libraries.js';
import type { Verdict } from './runtime.js';
import { compare, type SelfTestEntry } from './selftest.js';
import { readShared, shareFragment } from './share.js';

/** What the self-test drives: the page's own functions, so it takes the paths a user's clicks take. */
export interface Page {
	readonly libraries: readonly Library[];
	readonly examples: readonly Example[];
	selectLibrary(id: string): Promise<void>;
	showExample(id: string): void;
	/** The validator findings (`severity code path`) and the runtime verdict the page shows now. */
	shown(): { readonly findings: string[]; readonly runtime: Verdict | undefined };
	/** Every finding the page shows (validator and quality, `code path`), each with its fix button if offered. */
	/** The findings (`code path`) the engine offers a fix for. */
	fixable(): readonly string[];
	offers(): readonly { readonly finding: string; readonly apply: (() => void) | undefined }[];
	stray(): number | undefined;
	library(): string;
	example(): string;
	notice(): string | null;
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
	const fragment = shareFragment(library, page.text());
	if (typeof fragment !== 'string') return [`not shareable: ${fragment.reason}`];
	const shared = readShared(fragment, [library]);
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
	const text = '{"type": "bar", "data": {"datasets": []}}';
	const fragment = shareFragment('chartjs', text);
	await navigate(page, typeof fragment === 'string' ? fragment : '');
	if (page.library() !== 'chartjs' || page.text() !== text) problems.push('a shared link did not open its config');
	if (page.example() !== '') problems.push(`a shared config shows example "${page.example()}"`);
	if (page.notice() !== '') problems.push(`a link that opened keeps the notice "${page.notice() ?? ''}"`);
	return problems;
}

/** One example shown, compared with its pins, its fixes applied, shared; `uncaught` is emptied into it. */
async function exampleEntry(page: Page, example: Example, uncaught: string[]): Promise<SelfTestEntry> {
	page.showExample(example.id);
	await settled();
	const observed = { ...page.shown(), uncaught: uncaught.splice(0), stray: page.stray() };
	const more = [...(await fixProblems(page)), ...shareProblems(page, example.library)];
	const late = uncaught.splice(0).map((error) => `uncaught error: ${error}`);
	return { id: example.id, ...observed, problems: [...compare(example, observed), ...more, ...late] };
}

/**
 * `?selftest`: show every example in turn and compare what the page shows with what the fixtures
 * pin, and every error the page left uncaught while it showed it; apply every fix it offers and undo
 * it; share it; then open links as a pasted one opens (entry `links`). The JSON report lands in
 * `#selftest` for apps/playground/tests/browser.test.mjs.
 */
export async function selfTest(page: Page): Promise<void> {
	const uncaught = uncaughtErrors();
	const report: SelfTestEntry[] = [];
	for (const library of page.libraries) {
		await page.selectLibrary(library.id);
		for (const example of page.examples.filter((candidate) => candidate.library === library.id))
			report.push(await exampleEntry(page, example, uncaught));
	}
	const links = await linkProblems(page);
	report.push({ id: 'links', findings: [], runtime: undefined, uncaught: [], stray: undefined, problems: links });
	const output = document.createElement('pre');
	output.id = 'selftest';
	output.textContent = JSON.stringify(report);
	document.body.append(output);
}
