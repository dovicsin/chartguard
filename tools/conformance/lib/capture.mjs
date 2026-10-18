const CHANNELS = ['warn', 'error'];

/**
 * Runs `render` and reports how the chart runtime reacted: whether it threw, and what it
 * printed on `console.warn` / `console.error` (both libraries report misuse there in
 * development builds). The console is restored even when `render` throws.
 */
export function observe(render) {
	const messages = [];
	const original = Object.fromEntries(CHANNELS.map((channel) => [channel, console[channel]]));
	for (const channel of CHANNELS)
		console[channel] = (...parts) => {
			messages.push({ channel, text: parts.map(String).join(' ') });
		};
	try {
		render();
		return { threw: undefined, messages };
	} catch (error) {
		return { threw: error instanceof Error ? error.message : String(error), messages };
	} finally {
		Object.assign(console, original);
	}
}

/** `accepted`: rendered silently. `complained`: rendered with warnings. `rejected`: threw or logged an error. */
export function verdictOf({ threw, messages }) {
	if (threw !== undefined || messages.some(({ channel }) => channel === 'error')) return 'rejected';
	return messages.length > 0 ? 'complained' : 'accepted';
}
