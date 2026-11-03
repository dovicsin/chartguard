/**
 * The messages between the page and a drawing frame (CG-06-06 part 4). Both sides check every message
 * structurally before reading it (values crossing a realm boundary are data, never trusted shapes).
 */

/** The libraries a frame can draw: their runtimes are bundled into it. */
const DRAWN = ['chartjs', 'echarts'] as const;
export type DrawnLibrary = (typeof DRAWN)[number];

/** What the page asks a frame to do, once: draw a config, or run CommonJS code (the user's source, on request). */
export type Request =
	| { readonly kind: 'config'; readonly library: DrawnLibrary; readonly config: unknown }
	| { readonly kind: 'code'; readonly code: string };

/** How a runtime reacted, with the same meaning as tools/conformance. */
export type Verdict = 'accepted' | 'complained' | 'rejected';

/** A frame's answers: it is ready for its request; what drawing it did. */
export type Reply =
	| { readonly kind: 'ready' }
	| {
			readonly kind: 'outcome';
			readonly verdict: Verdict;
			/** Throws, console warnings and errors during the draw, in order. */
			readonly messages: readonly string[];
			/** Errors nothing caught after the draw returned, until the frame answered. */
			readonly uncaught: readonly string[];
	  };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isStrings = (value: unknown): value is readonly string[] =>
	Array.isArray(value) && value.every((item) => typeof item === 'string');

const VERDICTS: readonly unknown[] = ['accepted', 'complained', 'rejected'];

export function isRequest(value: unknown): value is Request {
	if (!isRecord(value)) return false;
	if (value['kind'] === 'code') return typeof value['code'] === 'string';
	return value['kind'] === 'config' && (DRAWN as readonly unknown[]).includes(value['library']) && 'config' in value;
}

export function isReply(value: unknown): value is Reply {
	if (!isRecord(value)) return false;
	if (value['kind'] === 'ready') return true;
	return (
		value['kind'] === 'outcome' &&
		VERDICTS.includes(value['verdict']) &&
		isStrings(value['messages']) &&
		isStrings(value['uncaught'])
	);
}

export const isDrawn = (library: string): library is DrawnLibrary => (DRAWN as readonly string[]).includes(library);
