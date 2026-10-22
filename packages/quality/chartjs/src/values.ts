import { isContainer, ownDataProperty } from '@chartguard/core';
import {
	type Fact,
	firstSet,
	formatPath,
	type Item,
	numberElement,
	numberOr,
	type Orientation,
	readFact,
	unknown,
	valuesAt,
	type ValueSummary
} from '@chartguard/quality-core';

const isSet = (value: unknown): value is unknown => value !== undefined && typeof value !== 'function';
const ARCS = new Set(['pie', 'doughnut']);

/**
 * The key an object element's value is read by, with the default parsing: `value` for arcs
 * (`const { key = 'value' } = this._parsing`, dist/chart.js:1905), the value axis (`y`, or `x` for
 * horizontal datasets) for cartesian ones. Undefined where objects are not read.
 */
function objectKey(type: Fact<string>, orientation: Fact<Orientation>): string | undefined {
	if (type.known && ARCS.has(type.value)) return 'value';
	if (!orientation.known) return undefined;
	return orientation.value === 'vertical' ? 'y' : 'x';
}

/**
 * The values of a dataset's `data`: numbers, gaps (`null`), or objects read by `objectKey`. A
 * `parsing` option other than the default (custom keys, or `false` for pre-parsed data) is not read.
 */
export function valuesOf(
	config: unknown,
	item: Item,
	type: Fact<string>,
	orientation: Fact<Orientation>
): Fact<ValueSummary> {
	const at = [...item.segments, 'data'];
	const parsing = firstSet([
		readFact(config, [...item.segments, 'parsing'], isSet),
		readFact(config, ['options', 'parsing'], isSet)
	]);
	if (!parsing.known && parsing.reason !== 'unset') return unknown(formatPath(at), parsing.reason);
	if (parsing.known && parsing.value !== true) return unknown(formatPath(at), 'unmodelled');
	const key = objectKey(type, orientation);
	return valuesAt(config, at, (element, path) => {
		const number = numberElement(element, path);
		if (number !== undefined) return number;
		if (key === undefined || !isContainer(element) || Array.isArray(element))
			return unknown(formatPath(path), 'unmodelled');
		const value = ownDataProperty(element, key);
		if (!value.found) return unknown(formatPath([...path, key]), value.accessor ? 'accessor' : 'unmodelled');
		return numberOr(value.value, [...path, key], 'shape');
	});
}
