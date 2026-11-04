import {
	isRecord,
	keySegment,
	type OptionEdit,
	type OptionValue,
	ownDataProperty,
	pathSegments
} from '@chartguard/core';
import type ts from 'typescript';

import { type EditSite, objectWrittenInUse, type TextEdit } from './edits.js';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/u;

/** A key as source: bare where it is an identifier, else quoted. */
const keyText = (key: string): string => (IDENTIFIER.test(key) ? key : JSON.stringify(key));

/** `value` nested under `keys`, as source: `{ enabled: true }`. */
const nestedText = (keys: readonly string[], value: OptionValue): string =>
	keys.reduceRight((inner, key) => `{ ${keyText(key)}: ${inner} }`, JSON.stringify(value));

/**
 * How many of `keys` the config read already holds, each an object on the way; undefined where one
 * is not an object, or is there as `undefined` (an edit beside it would leave two keys of one name).
 */
function heldDepth(config: unknown, keys: readonly string[]): number | undefined {
	let value = config;
	for (const [depth, key] of keys.entries()) {
		if (!isRecord(value)) return undefined;
		const entry = ownDataProperty(value, key);
		if (!entry.found) return entry.accessor ? undefined : depth;
		if (entry.value === undefined) return undefined;
		value = entry.value;
	}
	return keys.length;
}

/** The keys of a path to an option, when every segment is a key and none is `__proto__`. */
function keysOf(path: string): string[] | undefined {
	const segments = pathSegments(path) ?? [];
	const keys = segments.filter((segment): segment is string => typeof segment === 'string');
	return keys.length === segments.length && keys.length > 0 && !keys.includes('__proto__') ? keys : undefined;
}

/** `entry` added after the object's last member, on that member's line indentation, or inside `{}`. */
function insertion(file: ts.SourceFile, object: ts.ObjectLiteralExpression, entry: string): TextEdit {
	const last = object.properties.at(-1);
	if (last === undefined) {
		const at = object.getStart(file) + 1;
		return { start: at, end: at, text: ` ${entry} ` };
	}
	const start = last.getStart(file);
	const before = file.text.slice(file.text.lastIndexOf('\n', start - 1) + 1, start);
	const separator = /^[ \t]*$/u.test(before) ? `,\n${before}` : ', ';
	return { start: last.end, end: last.end, text: `${separator}${entry}` };
}

/**
 * A quality edit that sets an option the config leaves unset (`set-option` without `from`) written
 * in source: the missing keys inserted into the deepest object the config holds on the path, only
 * when the use's own call writes that object literal (a spread or another variable holding it would
 * be changed for every other reader, or overridden). A key named `__proto__` is never written: in a
 * literal it sets the prototype.
 */
export function insertEdit(site: EditSite, fix: OptionEdit): TextEdit | undefined {
	const keys = Object.hasOwn(fix, 'from') ? undefined : keysOf(fix.path);
	if (keys === undefined) return undefined;
	const depth = heldDepth(site.use.value, keys);
	if (depth === undefined || depth === keys.length) return undefined;
	const object = objectWrittenInUse(site, `$${keys.slice(0, depth).map(keySegment).join('')}`);
	const [first, ...rest] = keys.slice(depth);
	if (object === undefined || first === undefined) return undefined;
	return insertion(site.file, object, `${keyText(first)}: ${nestedText(rest, fix.value)}`);
}
