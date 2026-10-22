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

/** The red, green, blue (0–255) and alpha (0–1) of a hex or `rgb()` colour, or undefined for other forms. */
function rgbaOf(color: string): readonly number[] | undefined {
	const key = colorKey(color);
	if (!key.startsWith('rgba(')) return undefined;
	return key.slice(5, -1).split(',').map(Number);
}

/** The relative luminance of a colour's red, green and blue (WCAG 2.2). */
function luminance([red = 0, green = 0, blue = 0]: readonly number[]): number {
	const linear = (channel: number): number => {
		const value = channel / 255;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/**
 * The contrast ratio (WCAG 2.2, 1 to 21) of `foreground` drawn over `background`: a translucent
 * foreground is composited over the background first. Undefined when either colour is not in a hex or
 * `rgb()` form, or the background is not opaque (whatever is behind it shows through).
 */
export function contrastRatio(foreground: string, background: string): number | undefined {
	const [front, back] = [rgbaOf(foreground), rgbaOf(background)];
	if (front === undefined || back?.[3] !== 1) return undefined;
	const alpha = front[3] ?? 1;
	const drawn = [0, 1, 2].map((index) => (front[index] ?? 0) * alpha + (back[index] ?? 0) * (1 - alpha));
	const [lighter, darker] = [luminance(drawn), luminance(back)].sort((a, b) => b - a);
	return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

/** Whether a colour draws nothing: `transparent`, or a hex or `rgb()` colour with zero alpha. */
export function isTransparent(color: string): boolean {
	if (color.trim().toLowerCase() === 'transparent') return true;
	return rgbaOf(color)?.[3] === 0;
}
