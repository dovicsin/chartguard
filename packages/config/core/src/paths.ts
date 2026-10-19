const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * The path segment of an object key: `.key` for an identifier, `["key"]` (JSON-quoted) for any
 * other, so every path names exactly one place (`$.title["te.xt"]` is not `$.title.te.xt`).
 */
export function keySegment(key: string): string {
	return IDENTIFIER.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}
