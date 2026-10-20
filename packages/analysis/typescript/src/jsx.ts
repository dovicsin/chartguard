import ts from 'typescript';

import type { Decoded } from './decoded.js';
import type { Tag } from './detector.js';
import type { Trace } from './trace.js';

/** A JSX prop's value: an expression, or `true` for a bare attribute (`<X notMerge />`). */
export type Prop = ts.Expression | true;

function attributeValue(initializer: ts.JsxAttributeValue | undefined): Prop | undefined {
	if (initializer === undefined) return true;
	return ts.isJsxExpression(initializer) ? initializer.expression : initializer;
}

/** JSX attributes in order; a spread attribute may supply any earlier prop, so those are dropped (A3). */
export function propsOf(tag: Tag): { props: Map<string, Prop>; spread: boolean } {
	const props = new Map<string, Prop>();
	let spread = false;
	for (const attribute of tag.attributes.properties) {
		if (ts.isJsxSpreadAttribute(attribute)) {
			props.clear();
			spread = true;
			continue;
		}
		const value = attributeValue(attribute.initializer);
		if (ts.isIdentifier(attribute.name) && value !== undefined) props.set(attribute.name.text, value);
	}
	return { props, spread };
}

const CONFIG_PROPS = ['data', 'options', 'plugins'];

/** The props of a react-chartjs-2 config, read into a new config with their traces. */
function readProps(
	props: Map<string, Prop>,
	named: readonly string[],
	read: (value: Prop) => Decoded
): { config: Record<string, unknown>; entries: Map<string, Trace>; complete: boolean } {
	const config = Object.create(null) as Record<string, unknown>;
	const entries = new Map<string, Trace>();
	let complete = true;
	for (const key of named) {
		const value = props.get(key);
		if (value === undefined) continue;
		const part = read(value);
		complete &&= part.complete;
		if (part.complete || part.value !== undefined) config[key] = part.value;
		if (part.trace !== undefined) entries.set(key, part.trace);
	}
	return { config, entries, complete };
}

/** react-chartjs-2: `{ type, data, options, plugins }` from the component (or its `type` prop) and its props. */
export function chartjsConfig(
	{ props, spread }: { props: Map<string, Prop>; spread: boolean },
	chartType: string | undefined,
	read: (value: Prop) => Decoded,
	tag: Tag
): Decoded {
	const { config, entries, complete } = readProps(
		props,
		chartType === undefined ? ['type', ...CONFIG_PROPS] : CONFIG_PROPS,
		read
	);
	// The component names the type: it comes first, as the `type` prop would.
	const typed = chartType === undefined ? entries : new Map([['type', { node: tag.tagName }], ...entries]);
	if (chartType !== undefined) config['type'] = chartType;
	const open = spread ? { open: { node: tag, reason: 'spread' as const } } : {};
	return { value: config, complete: complete && !spread, trace: { node: tag, entries: typed, ...open } };
}
