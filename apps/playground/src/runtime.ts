import type { Verdict } from './frame-protocol.js';

export type { Verdict } from './frame-protocol.js';

/** How the chart runtime reacted, with the same meaning as tools/conformance. */
export interface RuntimeOutcome {
	readonly verdict: Verdict;
	/** The thrown error and everything printed on console.warn / console.error, in order. */
	readonly messages: readonly string[];
	/** Errors nothing caught after the draw returned (a runtime's timer), until the frame answered. */
	readonly uncaught: readonly string[];
}

/** Draws one config into a container, once: each draw has a frame, and a runtime, of its own. */
export interface Renderer {
	render(container: HTMLElement, config: unknown): void;
}

type Channel = 'warn' | 'error';

/**
 * What a runtime reports while a frame draws: console.warn / console.error (both runtimes report
 * misuse there) and what a draw throws. The frame is discarded after one draw, so the console is
 * never restored.
 */
export class Capture {
	private readonly captured: { channel: Channel; text: string }[] = [];

	constructor(target: Pick<Console, 'warn' | 'error'> = console) {
		const capture =
			(channel: Channel) =>
			(...parts: unknown[]): void => {
				this.captured.push({ channel, text: parts.map(String).join(' ') });
			};
		Object.assign(target, { warn: capture('warn'), error: capture('error') });
	}

	/** Runs `draw`, recording what it throws. */
	run(draw: () => void): void {
		try {
			draw();
		} catch (error) {
			this.captured.push({ channel: 'error', text: error instanceof Error ? error.message : String(error) });
		}
	}

	/** `rejected` on a throw or an error message, `complained` on warnings only. */
	verdict(): Verdict {
		if (this.captured.some(({ channel }) => channel === 'error')) return 'rejected';
		return this.captured.length > 0 ? 'complained' : 'accepted';
	}

	messages(): string[] {
		return this.captured.map(({ text }) => text);
	}
}
