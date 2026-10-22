import { isContainer, ownDataProperty } from '@chartguard/core';
import {
	type Fact,
	formatPath,
	type Item,
	numberElement,
	numberOr,
	type PathSegment,
	readFact,
	readPath,
	unknown,
	type UnknownFact,
	type ValueAt,
	valuesAt,
	type ValueSummary
} from '@chartguard/quality-core';

const isSet = (value: unknown): value is unknown => value !== undefined && typeof value !== 'function';

/** A number, a gap (`null`, `'-'`: echarts' empty value), or undefined for anything else. */
const scalar = (value: unknown, path: readonly PathSegment[]): ValueAt | null | undefined =>
	value === '-' ? null : numberElement(value, path);

/** An element: a value, or `{ value }`; arrays (`[x, y]`, dimensions) are not read yet. */
function element(value: unknown, path: readonly PathSegment[]): ValueAt | null | UnknownFact {
	const direct = scalar(value, path);
	if (direct !== undefined) return direct;
	if (!isContainer(value) || Array.isArray(value)) return unknown(formatPath(path), 'unmodelled');
	const inner = ownDataProperty(value, 'value');
	if (!inner.found) return unknown(formatPath([...path, 'value']), inner.accessor ? 'accessor' : 'unmodelled');
	return inner.value === '-' ? null : numberOr(inner.value, [...path, 'value'], 'unmodelled');
}

/**
 * The values of a series' `data`. Data routed from a `dataset` component (`datasetIndex`, `datasetId`,
 * `encode`, or no `data` beside a `dataset`) is not read yet.
 */
export function valuesOf(config: unknown, item: Item): Fact<ValueSummary> {
	const at = [...item.segments, 'data'];
	const routing = ['datasetIndex', 'datasetId', 'encode'].map((key) =>
		readFact(config, [...item.segments, key], isSet)
	);
	const routed = routing.find((fact) => fact.known || fact.reason !== 'unset');
	if (routed !== undefined) return unknown(formatPath(at), routed.known ? 'unmodelled' : routed.reason);
	if (readPath(config, at) === undefined && readPath(config, ['dataset']) !== undefined)
		return unknown(formatPath(at), 'unmodelled');
	return valuesAt(config, at, element);
}
