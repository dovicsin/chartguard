import ts from 'typescript';

/** "Use `x` instead", "use x instead": what a deprecation notice says to use (an option name or path). */
const REPLACEMENT = /\buse\s+`?([A-Za-z_$][\w$.]*)`?\s+instead\b/i;

/**
 * The `@deprecated` tag of a property, as the upstream declaration states it: its first sentence,
 * and the replacement it names. Never a rename: a notice does not say the runtime reads the old
 * option under the new name, so renaming could change what is drawn.
 */
export function deprecationOf(symbol) {
	const tag = symbol.getJsDocTags().find(({ name }) => name === 'deprecated');
	if (tag === undefined) return undefined;
	const text = ts.displayPartsToString(tag.text).replace(/\s+/g, ' ').trim();
	const [sentence] = text.split(/(?<=\.)\s/);
	const replacement = REPLACEMENT.exec(text)?.[1];
	return {
		...(sentence === undefined || sentence === '' ? {} : { message: sentence }),
		...(replacement === undefined ? {} : { replacement })
	};
}
