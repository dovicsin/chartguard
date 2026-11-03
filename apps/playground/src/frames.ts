import { isReply, type Request } from './frame-protocol.js';
import type { RuntimeOutcome } from './runtime.js';

/** The outcome of one draw, or `unfinished` when its frame did not answer before the hang guard. */
export type DrawOutcome = RuntimeOutcome | { readonly verdict: 'unfinished'; readonly messages: readonly string[] };

/**
 * A hang guard, far above an honest draw: a frame running an endless loop is removed. Never a time
 * budget: what it removes is reported as unfinished, not as a verdict.
 */
const HANG_GUARD_MS = 15_000;

interface Pending {
	readonly frame: HTMLIFrameElement;
	readonly request: Request;
	readonly resolve: (outcome: DrawOutcome | undefined) => void;
	readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Draws in sandboxed frames (CG-06-06 part 4): one frame per draw, so every draw has a runtime of its
 * own and nothing a runtime holds outlives it; the previous frame is removed when the next one is
 * made. A frame has an opaque origin (`allow-scripts` only); its messages are read only from that
 * frame and only in the shapes the protocol defines.
 */
export class Frames {
	private pending: Pending | undefined;

	constructor(
		private readonly host: HTMLElement,
		private readonly source = './frame.html',
		private readonly guard = HANG_GUARD_MS
	) {
		window.addEventListener('message', (event) => {
			this.received(event);
		});
	}

	/** Draws `request` in a new frame; undefined when a later draw (or `clear`) replaced it first. */
	draw(request: Request): Promise<DrawOutcome | undefined> {
		this.clear();
		const frame = document.createElement('iframe');
		frame.className = 'preview__frame';
		frame.title = 'Chart preview';
		// Scripts only: no same-origin rights (an opaque origin), no popups, forms, navigation or downloads.
		frame.sandbox.add('allow-scripts');
		frame.src = this.source;
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.finish({
					verdict: 'unfinished',
					messages: [`No answer in ${String(this.guard / 1000)} s: the frame was removed.`]
				});
				this.clear();
			}, this.guard);
			this.pending = { frame, request, resolve, timer };
			this.host.replaceChildren(frame);
		});
	}

	/** Removes the frame; a draw still waiting resolves as replaced. */
	clear(): void {
		this.finish(undefined);
		this.host.replaceChildren();
	}

	/** How many frames the page holds: one at most. */
	count(): number {
		return this.host.querySelectorAll('iframe').length;
	}

	private finish(outcome: DrawOutcome | undefined): void {
		const { pending } = this;
		if (pending === undefined) return;
		this.pending = undefined;
		clearTimeout(pending.timer);
		pending.resolve(outcome);
	}

	private received(event: MessageEvent): void {
		const { pending } = this;
		const data: unknown = event.data;
		const target = pending?.frame.contentWindow ?? undefined;
		if (pending === undefined || target === undefined || event.source !== target || !isReply(data)) return;
		// Opaque origin: no origin to name; the message goes to that frame's window only.
		if (data.kind === 'ready') target.postMessage(pending.request, '*');
		else this.finish({ verdict: data.verdict, messages: data.messages, uncaught: data.uncaught });
	}
}
