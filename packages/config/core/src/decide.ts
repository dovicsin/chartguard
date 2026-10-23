import { ownDataProperty } from '@chartguard/core';

import { isListLike } from './kind.js';
import type { DefaultChoice, DefaultTest } from './schema.js';

/** `undefined`: the runtime decides this value only by coercion (`'3' > 0`), which is never run here. */
export type Decision = boolean | undefined;

function nonEmpty(value: unknown): Decision {
	if (isListLike(value)) return value.length > 0;
	return Boolean(value) ? undefined : false;
}

function positive(value: unknown): Decision {
	if (typeof value === 'number') return value > 0;
	return Boolean(value) ? undefined : false;
}

const TESTS: Readonly<Record<DefaultTest, (value: unknown) => Decision>> = { truthy: Boolean, nonEmpty, positive };

/** An absent property is `undefined`, as the runtime reads it; a getter never runs, so it decides nothing. */
export function decide(rule: DefaultChoice, value: object): Decision {
	const entry = ownDataProperty(value, rule.property);
	if (entry.found) return TESTS[rule.test](entry.value);
	return entry.accessor ? undefined : TESTS[rule.test](undefined);
}
