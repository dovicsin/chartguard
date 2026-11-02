import type { ChartLibrary, ChartPattern } from '@chartguard/analysis-typescript';
import { isRecord, type ValidationOptions } from '@chartguard/core';
import { assertQualityOptions, type QualityOptions, QualityOptionsError } from '@chartguard/quality-chartjs';

/** The libraries the analysis finds uses of; each is checked with its own adapter. */
const LIBRARIES: readonly ChartLibrary[] = ['chartjs', 'echarts', 'highcharts'];

/** The settings of a check: one context for every finding, as the CLI's options give it (CG-06-03, CG-06-04). */
export interface ChartGuardSettings {
	readonly libraryVersion: Partial<Record<ChartLibrary, string>>;
	readonly registries: ValidationOptions['registries'];
	readonly extensions: Partial<Record<ChartLibrary, readonly unknown[]>>;
	readonly patterns: readonly ChartPattern[];
	/** Rule levels, ignores, page context and ruleset for `chart-quality`, as `quality --settings` takes them. */
	readonly quality: QualityOptions | undefined;
	/** Project mode: `true` for each file's nearest tsconfig, or a tsconfig path; `false` reads each file alone. */
	readonly project: boolean | string;
}

/**
 * Settings a check cannot run with: every problem, each named by its key under `prefix` (where the
 * caller reads them: `settings.chartguard` in ESLint, `chartguard` in an editor). A setup error,
 * never a finding: the caller stops with it, as with any configuration error.
 */
export class SettingsError extends Error {
	override readonly name = 'SettingsError';
	constructor(
		readonly prefix: string,
		readonly problems: readonly string[]
	) {
		super(`ChartGuard: ${prefix} cannot be used:\n  ${problems.join('\n  ')}`);
	}
}

const KEYS = ['libraryVersion', 'registries', 'extensions', 'patterns', 'quality', 'project'] as const;
const isLibrary = (key: string): key is ChartLibrary => LIBRARIES.some((library) => library === key);

/** The problems of a `{ chartjs?, echarts?, highcharts? }` setting whose values must each pass `ok`. */
function perLibrary(
	prefix: string,
	key: string,
	value: unknown,
	{ ok, expected }: { readonly ok: (entry: unknown) => boolean; readonly expected: string }
): string[] {
	if (!isRecord(value)) return [`${prefix}.${key}: must be an object by library (chartjs, echarts, highcharts)`];
	return Object.entries(value).flatMap(([library, entry]) => {
		if (!isLibrary(library)) return [`${prefix}.${key}.${library}: unknown library (chartjs, echarts or highcharts)`];
		return ok(entry) ? [] : [`${prefix}.${key}.${library}: must be ${expected}`];
	});
}

/** The problems of the quality options, as every quality adapter checks them (they share quality-core's check). */
function qualityProblems(prefix: string, value: unknown): string[] {
	try {
		assertQualityOptions(value);
		return [];
	} catch (error) {
		if (!(error instanceof QualityOptionsError)) throw error;
		return error.problems.map((problem) => `${prefix}.quality: ${problem}`);
	}
}

const projectProblems = (prefix: string, value: unknown): string[] =>
	typeof value === 'boolean' || (typeof value === 'string' && value !== '')
		? []
		: [`${prefix}.project: must be true, false or a tsconfig path`];

/** The check of each key of `settings.chartguard`; a value's own shape (a registry, an extension) is its reader's to judge. */
const CHECKS: Readonly<Record<(typeof KEYS)[number], (prefix: string, value: unknown) => string[]>> = {
	libraryVersion: (prefix, value) =>
		perLibrary(prefix, 'libraryVersion', value, {
			ok: (entry) => typeof entry === 'string',
			expected: 'a version string'
		}),
	extensions: (prefix, value) =>
		perLibrary(prefix, 'extensions', value, { ok: Array.isArray, expected: 'a list of extensions' }),
	registries: (prefix, value) => (isRecord(value) ? [] : [`${prefix}.registries: must be an object of registries`]),
	patterns: (prefix, value) => (Array.isArray(value) ? [] : [`${prefix}.patterns: must be a list of patterns`]),
	quality: qualityProblems,
	project: projectProblems
};

const isKey = (key: string): key is (typeof KEYS)[number] => KEYS.some((known) => known === key);

/** The problems of one key of the settings. */
const problemsOf = (prefix: string, key: string, value: unknown): string[] =>
	isKey(key) ? CHECKS[key](prefix, value) : [`${prefix}.${key}: unknown key (${KEYS.join(', ')})`];

/**
 * The settings checked, named under `prefix` in every problem: absent is no setting; anything else
 * must be an object of known keys of the right shape.
 */
export function readSettings(given: unknown, prefix: string): ChartGuardSettings {
	if (given === undefined)
		return {
			libraryVersion: {},
			registries: undefined,
			extensions: {},
			patterns: [],
			quality: undefined,
			project: false
		};
	if (!isRecord(given)) throw new SettingsError(prefix, [`${prefix}: must be an object (${KEYS.join(', ')})`]);
	const problems = Object.entries(given).flatMap(([key, value]) => problemsOf(prefix, key, value));
	if (problems.length > 0) throw new SettingsError(prefix, problems);
	// The shapes were checked above; a value's own shape (a registry, an extension) is its reader's to judge.
	return {
		libraryVersion: given['libraryVersion'] ?? {},
		// The validator reads a registry context structurally and reports a malformed one, as the CLI does.
		registries: given['registries'] as ChartGuardSettings['registries'],
		extensions: given['extensions'] ?? {},
		patterns: (given['patterns'] ?? []) as ChartGuardSettings['patterns'],
		quality: given['quality'] as QualityOptions | undefined,
		project: (given['project'] ?? false) as boolean | string
	};
}
