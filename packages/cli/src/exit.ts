import type { Diagnostic } from '@chartguard/core';

import { EXIT_INVALID, EXIT_OK } from './exit-codes.js';
import type { FailOn } from './invocation.js';

/**
 * The exit status findings give under `--fail-on` (CG-06-02): `error` fails on a confirmed error
 * (`valid: false`, as core derived it, B1), `warning` also on any warning, `never` never. Usage and
 * input errors (2) and internal failures (3) are decided before and are not affected.
 */
export function exitStatus(
	failOn: FailOn,
	{ invalid, diagnostics }: { readonly invalid: boolean; readonly diagnostics: readonly Diagnostic[] }
): number {
	if (failOn === 'never') return EXIT_OK;
	if (invalid) return EXIT_INVALID;
	const warned = failOn === 'warning' && diagnostics.some(({ severity }) => severity === 'warning');
	return warned ? EXIT_INVALID : EXIT_OK;
}
