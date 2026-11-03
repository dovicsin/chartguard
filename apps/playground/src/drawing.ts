import { isDrawn, type Request } from './frame-protocol.js';
import { type DrawOutcome, Frames } from './frames.js';
import { libraryById } from './libraries.js';
import type { Draw } from './shown.js';
import { badge, messageItems } from './view.js';

/** The elements the preview and the runtime's verdict are shown in. */
export interface DrawingElements {
	readonly preview: HTMLElement;
	readonly runtime: HTMLElement;
	readonly messages: HTMLUListElement;
	readonly note: HTMLElement;
}

const RAN = 'Ran the source in a sandbox: the verdict is the runtime’s; the findings stay those of the static checks.';

/** The badge's colour: a verdict's own, an unfinished draw's as a rejection, none while waiting. */
function toneOf(outcome: DrawOutcome | undefined): string {
	if (outcome === undefined) return 'muted';
	return outcome.verdict === 'unfinished' ? 'rejected' : outcome.verdict;
}

/**
 * The preview and the runtime's verdict: each draw in a frame of its own (`Frames`), shown when the
 * frame answers; a draw replaced before it answered shows nothing.
 */
export class Drawing {
	private readonly frames: Frames;
	/** The verdict shown now, if a draw answered. */
	outcome: DrawOutcome | undefined;
	/** Settles when the last draw has been shown (or replaced). */
	done: Promise<void> = Promise.resolve();

	constructor(private readonly elements: DrawingElements) {
		this.frames = new Frames(elements.preview);
	}

	/** Draws what the checked text gives, or says why nothing is drawn. */
	show(draw: Draw): void {
		this.done = this.drawn(draw);
	}

	/** Runs the user's transpiled source in a frame (only on the user's request). */
	run(code: string): void {
		this.done = this.requested({ kind: 'code', code }, RAN);
	}

	/** How many frames the page holds: one at most. */
	frameCount(): number {
		return this.frames.count();
	}

	private async drawn(draw: Draw): Promise<void> {
		if (draw.kind === 'config' && isDrawn(draw.library)) {
			await this.requested({ kind: 'config', library: draw.library, config: draw.config }, undefined);
			return;
		}
		this.frames.clear();
		const reason = draw.kind === 'none' ? draw.reason : (libraryById(draw.library)?.noPreview ?? '');
		this.elements.preview.textContent = reason;
		this.display(undefined, draw.kind === 'none' ? 'not run' : 'no preview', undefined);
	}

	private async requested(request: Request, note: string | undefined): Promise<void> {
		this.display(undefined, 'drawing…', undefined);
		const outcome = await this.frames.draw(request);
		if (outcome !== undefined) this.display(outcome, outcome.verdict, note);
	}

	private display(outcome: DrawOutcome | undefined, verdict: string, note: string | undefined): void {
		const { runtime, messages, note: noteElement } = this.elements;
		this.outcome = outcome;
		runtime.replaceChildren(badge(verdict, toneOf(outcome)));
		const uncaught = outcome !== undefined && 'uncaught' in outcome ? outcome.uncaught : [];
		const lines = [...(outcome?.messages ?? []), ...uncaught.map((error) => `uncaught: ${error}`)];
		messages.replaceChildren(...messageItems(lines));
		messages.hidden = lines.length === 0;
		noteElement.textContent = note ?? '';
		noteElement.hidden = note === undefined;
	}
}
