import {
	applyFix,
	type Diagnostic,
	FixError,
	isContainer,
	type OptionEdit,
	type OptionValue,
	ownDataProperty,
	pathSegments,
	type QualityReport
} from '@chartguard/core';

/** What a finding's option holds now: nothing, or a JSON primitive. */
export type Current = { readonly set: false } | { readonly set: true; readonly value: OptionValue };

/** The value a remedy gives the finding's option, and what that changes. */
export interface Remedy {
	readonly value: OptionValue;
	readonly effect: string;
}

/**
 * How an adapter remedies its findings of one rule: the value the option at the finding's `path`
 * should get, decided from what it holds now (and, for a precondition, the rest of the config);
 * undefined when there is no fix it can stand behind.
 */
export type Remedies = Readonly<Record<string, (now: Current, path: string, config: unknown) => Remedy | undefined>>;

/** What the option at `path` holds, or undefined when it is not a plain value (an object, a getter, a function). */
export function currentAt(config: unknown, path: string): Current | undefined {
	return readCurrent(config, path);
}

const isOptionValue = (value: unknown): value is OptionValue =>
	value === null || ['string', 'number', 'boolean'].includes(typeof value);

/** What the option at `path` holds, read through own data properties; undefined when it cannot be edited as a value. */
function readCurrent(config: unknown, path: string): Current | undefined {
	const segments = pathSegments(path);
	if (segments === undefined || segments.length === 0) return undefined;
	let value = config;
	for (const segment of segments) {
		if (value === undefined) return { set: false };
		if (!isContainer(value)) return undefined;
		const entry = ownDataProperty(value, String(segment));
		if (!entry.found) return entry.accessor ? undefined : { set: false };
		({ value } = entry);
	}
	if (value === undefined) return { set: false };
	return isOptionValue(value) ? { set: true, value } : undefined;
}

const keyOf = ({ code, path }: Diagnostic): string => `${code} ${path}`;

/** Every finding of a report, reported or suppressed. */
const findingsOf = (report: QualityReport): Diagnostic[] => [
	...report.diagnostics,
	...report.suppressed.map(({ diagnostic }) => diagnostic)
];

/** The edit a remedy proposes for a finding, from what its option holds now; undefined without one. */
function proposedEdit(finding: Diagnostic, config: unknown, remedies: Remedies): OptionEdit | undefined {
	const remedy = finding.ruleId === undefined ? undefined : remedies[finding.ruleId];
	const now = remedy === undefined ? undefined : currentAt(config, finding.path);
	const proposal = now === undefined ? undefined : remedy?.(now, finding.path, config);
	if (now === undefined || proposal === undefined) return undefined;
	return {
		kind: 'set-option',
		path: finding.path,
		...(now.set ? { from: now.value } : {}),
		value: proposal.value,
		effect: proposal.effect
	};
}

/**
 * The edit for one finding, offered only when it is verified: applied to the config and analysed
 * again, the finding is gone and no finding appears that was not there before (CG-05-06).
 */
function verifiedFix(
	finding: Diagnostic,
	config: unknown,
	remedies: Remedies,
	{ before, analyze }: { before: ReadonlySet<string>; analyze: (config: unknown) => QualityReport }
): OptionEdit | undefined {
	const edit = proposedEdit(finding, config, remedies);
	if (edit === undefined) return undefined;
	try {
		const after = new Set(findingsOf(analyze(applyFix(config, edit))).map(keyOf));
		return !after.has(keyOf(finding)) && [...after].every((key) => before.has(key)) ? edit : undefined;
	} catch (error) {
		if (error instanceof FixError) return undefined;
		throw error;
	}
}

/**
 * The report with a verified `set-option` fix on each finding an adapter remedies (reported or
 * suppressed). `analyze` reviews a config the way the report was made (same adapter, same options).
 */
export function withFixes(
	report: QualityReport,
	config: unknown,
	remedies: Remedies,
	analyze: (config: unknown) => QualityReport
): QualityReport {
	const before = new Set(findingsOf(report).map(keyOf));
	const fixed = (finding: Diagnostic): Diagnostic => {
		const fix = verifiedFix(finding, config, remedies, { before, analyze });
		return fix === undefined ? finding : { ...finding, fix };
	};
	return {
		...report,
		diagnostics: report.diagnostics.map(fixed),
		suppressed: report.suppressed.map((suppression) => ({ ...suppression, diagnostic: fixed(suppression.diagnostic) }))
	};
}
