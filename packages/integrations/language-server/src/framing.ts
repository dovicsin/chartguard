/**
 * LSP's base protocol: each message a header (`Content-Length`, in bytes) and a JSON body. A reader is
 * bounded: a message larger than `MAX_MESSAGE_BYTES` or a header without a length ends the connection,
 * since what follows can no longer be told apart (E33: untrusted input is bounded before it is read).
 */
const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
/** A header longer than this is not a header. */
const MAX_HEADER_BYTES = 8 * 1024;
const SEPARATOR = '\r\n\r\n';

/** Why a connection cannot go on: its framing is broken. */
export class FramingError extends Error {
	override readonly name = 'FramingError';
}

/** The length a header declares, or the reason it cannot be read. */
function lengthOf(header: string): number {
	const match = /^Content-Length: *(\d+) *$/imu.exec(header);
	if (match === null) throw new FramingError('a message header without Content-Length');
	const length = Number(match[1]);
	if (length > MAX_MESSAGE_BYTES)
		throw new FramingError(`a message of ${String(length)} bytes; at most ${String(MAX_MESSAGE_BYTES)} are read`);
	return length;
}

/** Splits incoming bytes into message bodies (text); throws `FramingError` when the framing breaks. */
export class MessageReader {
	private buffered = Buffer.alloc(0);

	/** Every body completed by `chunk`, in order. */
	push(chunk: Buffer): string[] {
		this.buffered = Buffer.concat([this.buffered, chunk]);
		const bodies: string[] = [];
		for (;;) {
			const end = this.buffered.indexOf(SEPARATOR);
			if (end === -1) {
				if (this.buffered.length > MAX_HEADER_BYTES) throw new FramingError('a message header without an end');
				return bodies;
			}
			const length = lengthOf(this.buffered.subarray(0, end).toString('ascii'));
			const start = end + SEPARATOR.length;
			if (this.buffered.length < start + length) return bodies;
			bodies.push(this.buffered.subarray(start, start + length).toString('utf8'));
			this.buffered = this.buffered.subarray(start + length);
		}
	}
}

/** One message framed for the wire. */
export function framed(message: unknown): Buffer {
	const body = Buffer.from(JSON.stringify(message), 'utf8');
	return Buffer.concat([Buffer.from(`Content-Length: ${String(body.length)}${SEPARATOR}`, 'ascii'), body]);
}
