import { deflateSync, Inflate } from 'fflate';

/**
 * A config shared as a link (CG-06-06 part 2): `#library=<id>&config=<base64url>`, the editor text
 * (with `&mode=<input>` for source text, part 3)
 * deflated. The fragment never reaches a server. Reading one is bounded: the encoded length before
 * decoding, the inflated size while inflating (a small link may inflate to gigabytes), and the text
 * must be UTF-8. What it yields only ever goes into the editor, which parses it as JSON. Synchronous
 * (fflate): the browser's CompressionStream runs off the main thread, and headless Chrome's virtual
 * time, which the self-test runs in, does not wait for it.
 */
export const MAX_FRAGMENT_LENGTH = 100_000;
export const MAX_SHARED_BYTES = 1_000_000;

export type Shared =
	| { readonly ok: true; readonly library: string; readonly mode: string; readonly text: string }
	| { readonly ok: false; readonly reason: string };

const BASE64URL = /^[A-Za-z0-9_-]*$/u;

function base64url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function fromBase64url(text: string): Uint8Array | undefined {
	if (!BASE64URL.test(text) || text.length % 4 === 1) return undefined;
	const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** How much deflated input is inflated at a time: one step adds at most about 1 kB per input byte to the bound. */
const STEP = 256;

/** The bytes `deflated` inflates to, or `undefined` when they exceed `limit`: checked after every step, never at the end. */
function inflateBounded(deflated: Uint8Array, limit: number): Uint8Array | undefined {
	const chunks: Uint8Array[] = [];
	let size = 0;
	const inflater = new Inflate((chunk) => {
		size += chunk.byteLength;
		chunks.push(chunk);
	});
	let next = 0;
	do {
		inflater.push(deflated.subarray(next, next + STEP), next + STEP >= deflated.byteLength);
		next += STEP;
	} while (next < deflated.byteLength && size <= limit);
	if (size > limit) return undefined;
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

/**
 * The fragment (without `#`) that opens `text` in `library`'s editor, or why there is none: a link
 * `readShared` would refuse is never made.
 */
export function shareFragment(
	{ library, mode }: { readonly library: string; readonly mode: string },
	text: string
): string | { readonly reason: string } {
	const bytes = new TextEncoder().encode(text);
	if (bytes.byteLength > MAX_SHARED_BYTES)
		return { reason: `the config is larger than ${String(MAX_SHARED_BYTES)} bytes` };
	const encoded = base64url(deflateSync(bytes, { level: 9 }));
	if (encoded.length > MAX_FRAGMENT_LENGTH)
		return { reason: `the link would be longer than ${String(MAX_FRAGMENT_LENGTH)} characters` };
	return new URLSearchParams({ library, ...(mode === 'json' ? {} : { mode }), config: encoded }).toString();
}

/** The bytes a link's `config` inflates to, or why it cannot be read. */
function inflate(encoded: string): Uint8Array | string {
	if (encoded.length > MAX_FRAGMENT_LENGTH) return `the link is longer than ${String(MAX_FRAGMENT_LENGTH)} characters`;
	const bytes = fromBase64url(encoded);
	if (bytes === undefined) return 'the config is not base64url';
	// Deflated data holds at least its final block; fflate reads nothing as nothing.
	if (bytes.byteLength === 0) return 'the config is not deflated data';
	try {
		return inflateBounded(bytes, MAX_SHARED_BYTES) ?? `the config is larger than ${String(MAX_SHARED_BYTES)} bytes`;
	} catch {
		return 'the config is not deflated data';
	}
}

/**
 * The config a fragment shares, why it cannot be read, or `undefined` when the fragment shares none
 * (an example id). `known`: the libraries and input modes the page knows (`json` when the link names
 * none); any other is refused.
 */
export function readShared(
	fragment: string,
	known: { readonly libraries: readonly string[]; readonly modes: readonly string[] }
): Shared | undefined {
	const parameters = new URLSearchParams(fragment);
	const encoded = parameters.get('config');
	if (encoded === null) return undefined;
	const library = parameters.get('library') ?? '';
	if (!known.libraries.includes(library)) return { ok: false, reason: `unknown library "${library}"` };
	const mode = parameters.get('mode') ?? 'json';
	if (!known.modes.includes(mode)) return { ok: false, reason: `unknown input "${mode}"` };
	const bytes = inflate(encoded);
	if (typeof bytes === 'string') return { ok: false, reason: bytes };
	try {
		return { ok: true, library, mode, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
	} catch {
		return { ok: false, reason: 'the config is not UTF-8 text' };
	}
}
