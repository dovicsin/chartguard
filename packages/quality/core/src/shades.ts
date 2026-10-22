import type { Shades } from './chart.js';
import type { Fact } from './facts.js';

/** A colour that does not depend on the colour scheme: the same shade in both. */
export function sameShades(color: Fact<string>): Fact<Shades> {
	if (!color.known) return color;
	return { ...color, value: { light: color, dark: color } };
}
