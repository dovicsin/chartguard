const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * The path segment of an object key: `.key` for an identifier, `["key"]` (JSON-quoted) for any
 * other, so every path names exactly one place (`$.title["te.xt"]` is not `$.title.te.xt`).
 */
export function keySegment(key: string): string {
	return IDENTIFIER.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

const SEGMENT = /\.([A-Za-z_$][\w$]*)|\[(0|[1-9]\d*)\]|\[("(?:[^"\\]|\\.)*")\]/y;

/** The key a quoted segment names, when it is quoted as `keySegment` quotes it; otherwise undefined. */
function quotedKey(quoted: string): string | undefined {
	let key: unknown;
	try {
		key = JSON.parse(quoted);
	} catch {
		return undefined;
	}
	return typeof key === 'string' && keySegment(key) === `[${quoted}]` ? key : undefined;
}

/** One segment as `SEGMENT` matched it; undefined for a spelling `keySegment` does not write. */
function segmentOf([, name, index, quoted]: RegExpExecArray): string | number | undefined {
	if (name !== undefined) return name;
	if (index !== undefined) {
		const value = Number(index);
		return Number.isSafeInteger(value) ? value : undefined;
	}
	return quoted === undefined ? undefined : quotedKey(quoted);
}

/**
 * The keys and indices a path names, in order: the inverse of the notation `keySegment` writes
 * (`$.series[0].label["a b"]` → `['series', 0, 'label', 'a b']`); undefined for anything else. Only
 * that one spelling is read, so a place has one path (`[01]`, `["a"]` or an escaped key are not
 * paths, E29), and a malformed one is undefined, never a thrown error (K15).
 */
export function pathSegments(path: string): (string | number)[] | undefined {
	if (!path.startsWith('$')) return undefined;
	const segments: (string | number)[] = [];
	SEGMENT.lastIndex = 1;
	while (SEGMENT.lastIndex < path.length) {
		const start = SEGMENT.lastIndex;
		const match = SEGMENT.exec(path);
		if (match?.index !== start) return undefined;
		const segment = segmentOf(match);
		if (segment === undefined) return undefined;
		segments.push(segment);
	}
	return segments;
}
