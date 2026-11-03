import { observe, type Renderer, type RuntimeOutcome } from './runtime.js';
import type { Draw } from './shown.js';

/**
 * The preview: draws a config with its library's runtime, or says why nothing is drawn. A runtime
 * that drew before and is not the next one's releases its chart first (E51).
 */
export class Preview {
	private current: Renderer | undefined;
	/** What each runtime printed in this page so far. */
	private readonly printed = new Map<Renderer, Set<string>>();
	private lastNote: string | undefined;

	constructor(private readonly container: HTMLElement) {}

	/** The runtime's verdict, or undefined when nothing was drawn (`renderer` undefined: not bundled). */
	show(draw: Draw, renderer: Renderer | undefined, noPreview: string): RuntimeOutcome | undefined {
		if (draw.kind === 'none' || renderer === undefined) {
			this.clear();
			this.container.textContent = draw.kind === 'none' ? draw.reason : noPreview;
			return undefined;
		}
		if (this.current !== renderer) this.current?.dispose();
		this.current = renderer;
		const outcome = observe(() => {
			renderer.render(this.container, draw.config);
		});
		this.lastNote = this.noteFor(renderer);
		const printed = this.printed.get(renderer) ?? new Set();
		for (const message of outcome.messages) printed.add(message);
		this.printed.set(renderer, printed);
		return outcome;
	}

	/**
	 * Why the last verdict may miss messages: its runtime prints some only once in a page, and printed
	 * some before this draw. A fresh runtime per draw (part 4) removes the cause.
	 */
	note(): string | undefined {
		return this.lastNote;
	}

	private noteFor(renderer: Renderer): string | undefined {
		const earlier = this.printed.get(renderer)?.size ?? 0;
		if (!renderer.logsOnce || earlier === 0) return undefined;
		return `This runtime prints some messages only once in a page, and printed ${String(earlier)} before this chart: the verdict may miss them. Reload the page to see them again.`;
	}

	clear(): void {
		this.current?.dispose();
		this.current = undefined;
		this.container.replaceChildren();
	}

	/** Charts the runtimes that drew before and are not drawing now still hold: a switch releases them. */
	leftover(): number {
		return [...this.printed.keys()]
			.filter((renderer) => renderer !== this.current)
			.reduce((sum, renderer) => sum + renderer.held(), 0);
	}

	/** Charts the runtime that drew last still holds besides the one shown. */
	stray(): number | undefined {
		return this.current?.stray();
	}
}
