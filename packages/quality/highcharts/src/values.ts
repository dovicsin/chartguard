import { isContainer, ownDataProperty } from '@chartguard/core';
import {
	type Fact,
	formatPath,
	type Item,
	numberElement,
	numberOr,
	type PathSegment,
	readFact,
	unknown,
	type UnknownFact,
	type ValueAt,
	valuesAt,
	type ValueSummary
} from '@chartguard/quality-core';

const isSet = (value: unknown): value is unknown => value !== undefined && typeof value !== 'function';

/** An element: `y`, `[x, y]` (also `[name, y]`), or `{ y }`; longer arrays and other keys are not read yet. */
function element(value: unknown, path: readonly PathSegment[]): ValueAt | null | UnknownFact {
	const direct = numberElement(value, path);
	if (direct !== undefined) return direct;
	if (Array.isArray(value)) {
		if (value.length !== 2) return unknown(formatPath(path), 'unmodelled');
		const y = ownDataProperty(value, '1');
		return y.found ? numberOr(y.value, [...path, 1], 'shape') : unknown(formatPath([...path, 1]), 'accessor');
	}
	if (!isContainer(value)) return unknown(formatPath(path), 'shape');
	const y = ownDataProperty(value, 'y');
	if (!y.found) return unknown(formatPath([...path, 'y']), y.accessor ? 'accessor' : 'unmodelled');
	return numberOr(y.value, [...path, 'y'], 'shape');
}

/** The values of a series' `data`. `keys` (in the series or its `plotOptions`) remaps arrays: not read yet. */
export function valuesOf(config: unknown, item: Item, type: Fact<string>): Fact<ValueSummary> {
	const at = [...item.segments, 'data'];
	const scopes = [item.segments, ['plotOptions', type.known ? type.value : 'series'], ['plotOptions', 'series']];
	const keys = scopes
		.map((scope) => readFact(config, [...scope, 'keys'], isSet))
		.find((fact) => fact.known || fact.reason !== 'unset');
	if (keys !== undefined) return unknown(formatPath(at), keys.known ? 'unmodelled' : keys.reason);
	return valuesAt(config, at, element);
}
