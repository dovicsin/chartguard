/** Runtime kind of a value in schema terms. */
export function kindOf(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	return typeof value;
}
