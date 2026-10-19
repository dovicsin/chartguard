import { type Diagnostic, ownDataProperty } from '@chartguard/core';

import type { Deprecation } from './schema.js';

/**
 * The rename the runtime itself performs, offered only while the new key is free (otherwise a value
 * would be lost) and the value is set: the runtime copies only `!= null` values, so renaming a
 * `null` would hand the new option a value the runtime never gave it.
 */
function safeRename(object: object, value: unknown, { renameTo }: Deprecation): Diagnostic['fix'] {
	if (renameTo === undefined || value === null) return undefined;
	const target = ownDataProperty(object, renameTo);
	const free = target.found ? target.value === undefined : !target.accessor;
	return free ? { kind: 'rename-key', to: renameTo } : undefined;
}

/**
 * A deprecated option the config sets: a certain warning (the upstream says so), naming the
 * replacement, with a safe fix only when the runtime itself reads the option under its new name.
 */
export function deprecationFinding(object: object, key: string, path: string, deprecation: Deprecation): Diagnostic {
	const { message, since, replacement } = deprecation;
	const entry = ownDataProperty(object, key);
	const fix = safeRename(object, entry.found ? entry.value : undefined, deprecation);
	return {
		code: 'CFG_DEPRECATED',
		severity: 'warning',
		confidence: 'certain',
		path,
		message: `Deprecated${since === undefined ? '' : ` since ${since}`}: ${message ?? 'the upstream marks this option deprecated; it still works for now.'}`,
		...(replacement === undefined ? {} : { suggestion: `Use "${replacement}" instead.` }),
		...(fix === undefined ? {} : { fix })
	};
}
