/** How the chart runtime reacted, with the same meaning as tools/conformance. */
export type Verdict = 'accepted' | 'complained' | 'rejected';

export interface RuntimeOutcome {
	readonly verdict: Verdict;
	/** The thrown error and everything printed on console.warn / console.error, in order. */
	readonly messages: readonly string[];
}

/** Draws one config into a container and releases it again; created per library, reused across renders. */
export interface Renderer {
	render(container: HTMLElement, config: unknown): void;
	dispose(): void;
}

type Channel = 'warn' | 'error';

/**
 * Runs `draw` with console.warn / console.error captured; both runtimes report misuse there.
 * The console is restored even when `draw` throws.
 */
export function observe(draw: () => void): RuntimeOutcome {
	const captured: { channel: Channel; text: string }[] = [];
	const original = { warn: console.warn, error: console.error };
	const capture =
		(channel: Channel) =>
		(...parts: unknown[]): void => {
			captured.push({ channel, text: parts.map(String).join(' ') });
		};
	console.warn = capture('warn');
	console.error = capture('error');
	try {
		draw();
	} catch (error) {
		captured.push({ channel: 'error', text: error instanceof Error ? error.message : String(error) });
	} finally {
		console.warn = original.warn;
		console.error = original.error;
	}
	return { verdict: verdictOf(captured), messages: captured.map(({ text }) => text) };
}

/** `rejected` on a throw or an error message, `complained` on warnings only. */
function verdictOf(captured: readonly { channel: Channel }[]): Verdict {
	if (captured.some(({ channel }) => channel === 'error')) return 'rejected';
	return captured.length > 0 ? 'complained' : 'accepted';
}
