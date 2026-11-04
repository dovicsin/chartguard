import type { NodeSchema } from './schema.js';

/** Where the walk is: the path, the depth and what the schema on the way says about the findings here. */
export interface Cursor {
	readonly path: string;
	readonly depth: number;
	/** A schema fact on the way here is not authoritative: findings below are likely, not confirmed (CG-02-07). */
	readonly inferred: boolean;
	/** The unions already choosing a variant for the value here: one reached again would choose without end (H6). */
	readonly choosing?: ReadonlySet<NodeSchema>;
	/** What the runtime does with a value of another type here (`onMismatch`, A73); dropped one level down. */
	readonly onMismatch?: string;
}

export const ROOT: Cursor = { path: '$', depth: 0, inferred: false };

export function descend({ path, depth, inferred }: Cursor, segment: string): Cursor {
	return { path: `${path}${segment}`, depth: depth + 1, inferred };
}

/** The cursor at `schema`: inferred from there on when the schema's own facts are. */
export function at(cursor: Cursor, schema: NodeSchema | undefined): Cursor {
	const tiered = schema?.inferred === true && !cursor.inferred ? { ...cursor, inferred: true } : cursor;
	return schema?.onMismatch === undefined ? tiered : { ...tiered, onMismatch: schema.onMismatch };
}
