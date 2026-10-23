import type { NodeSchema } from './schema.js';

/** Same-kind primitives: any unrestricted member widens to the whole kind, otherwise enums merge. */
export function mergePrimitives(members: readonly NodeSchema[], likely: boolean): NodeSchema {
	const [first] = members;
	const kind = first?.kind ?? 'any';
	const tier = likely ? { inferred: true as const } : {};
	if (members.some((member) => member.enum === undefined)) return { kind, ...tier };
	return { kind, enum: members.flatMap((member) => member.enum ?? []), ...tier };
}

export function mergeArrays(members: readonly NodeSchema[], likely: boolean): NodeSchema {
	const elements = members.map((member): NodeSchema => member.element ?? { kind: 'any' });
	return { kind: 'array', element: { kind: 'union', anyOf: elements }, ...(likely ? { inferred: true as const } : {}) };
}
