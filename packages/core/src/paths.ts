const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * The path segment of an object key: `.key` for an identifier, `["key"]` (JSON-quoted) for any
 * other, so every path names exactly one place (`$.title["te.xt"]` is not `$.title.te.xt`).
 */
export function keySegment(key: string): string {
	return IDENTIFIER.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

const SEGMENT = /\.([A-Za-z_$][\w$]*)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\]/y;

/**
 * The keys and indices a path names, in order: the inverse of the notation `keySegment` writes
 * (`$.series[0].label["a b"]` → `['series', 0, 'label', 'a b']`); undefined for anything else.
 */
export function pathSegments(path: string): (string | number)[] | undefined {
	if (!path.startsWith('$')) return undefined;
	const segments: (string | number)[] = [];
	SEGMENT.lastIndex = 1;
	while (SEGMENT.lastIndex < path.length) {
		const start = SEGMENT.lastIndex;
		const match = SEGMENT.exec(path);
		if (match?.index !== start) return undefined;
		const [, name, index, quoted] = match;
		segments.push(name ?? (index === undefined ? (JSON.parse(quoted ?? '""') as string) : Number(index)));
	}
	return segments;
}
