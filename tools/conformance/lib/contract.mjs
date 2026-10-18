const signalled = (runtime) => runtime !== 'accepted';
const severityOf = (finding) => finding.split(' ')[0];

/**
 * Which explanation a validator/runtime pair needs, or undefined when they agree.
 *
 * - A confirmed error the runtime does not signal is a type-contract error: allowed (wrong
 *   primitive or undocumented enum in a closed API) but always explained.
 * - A runtime rejection we do not report as an error is either an unresolved extension point
 *   (we warned) or a false negative, which must name the roadmap item that will cover it.
 * - A warning on a config the runtime renders silently needs a reason too: the runtime
 *   ignores the key, or the value is undeclared.
 */
export function requiredExplanation({ findings, runtime }) {
	const severities = new Set(findings.map(severityOf));
	if (severities.has('error')) return signalled(runtime) ? undefined : 'Type contract:';
	if (severities.has('warning')) return 'Unresolved:';
	return signalled(runtime) ? 'False negative (CG-' : undefined;
}
