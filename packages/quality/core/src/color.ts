const HEX = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;
const RGB = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i;

function fromHex(digits: string): readonly number[] {
	const full = digits.length <= 4 ? digits.replace(/./g, (digit) => digit + digit) : digits;
	const channels = (full.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16));
	return channels.length === 3 ? [...channels, 1] : [...channels.slice(0, 3), (channels[3] ?? 255) / 255];
}

function fromRgb(match: RegExpExecArray): readonly number[] {
	const alpha = match[4] ?? '1';
	const opacity = Number.parseFloat(alpha) / (alpha.endsWith('%') ? 100 : 1);
	return [Number(match[1]), Number(match[2]), Number(match[3]), opacity];
}

/**
 * A key under which two CSS colours that are the same compare equal: `#f00`, `#ff0000` and
 * `rgb(255, 0, 0)` share one. Other forms (names, `hsl()`, CSS variables) keep their own text, so two
 * identical texts are the same colour; a text and an equivalent other form are not recognised as
 * the same (a rule claims only sameness it can see, never distinctness).
 */
export function colorKey(color: string): string {
	const text = color.trim().toLowerCase();
	const hex = HEX.exec(text);
	if (hex?.[1] !== undefined) return `rgba(${fromHex(hex[1]).join(',')})`;
	const rgb = RGB.exec(text);
	if (rgb !== null) return `rgba(${fromRgb(rgb).join(',')})`;
	return text.replace(/\s+/g, '');
}
