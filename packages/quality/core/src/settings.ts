import { isContainer, keySegment, ownDataProperty, pathSegments } from '@chartguard/core';

import { type ContextFact, type Impact, SEVERITY_OF_IMPACT } from './catalog.js';
import { contrastRatio } from './color.js';

/** How a rule reports: not at all (`off`: it does not run), or at this severity. Never `error`: quality is advisory. */
export type RuleLevel = 'off' | 'info' | 'warning';

/** A finding of the rule at `path`, or inside it, is not reported; `reason` says why, and is kept with it. */
export interface Ignore {
	readonly path: string;
	readonly reason: string;
}

/** The caller's setting for one rule: its level, and where its findings are ignored. */
export interface RuleSetting {
	readonly level?: RuleLevel;
	readonly ignore?: readonly Ignore[];
}

/** A CSS colour (hex or `rgb()`, opaque) for every colour scheme, or one per scheme the page shows. */
export type PageBackground = string | { readonly light?: string; readonly dark?: string };

/**
 * Facts about where the chart is shown, which its config cannot show (CG-05-05). Each is the caller's
 * declaration: findings that rest on it are as true as it is.
 */
export interface QualityContext {
	/** The page behind a chart that draws no background of its own. */
	readonly background?: PageBackground;
	/** Whether the page describes the chart's data to assistive technology (a data table, a text alternative). */
	readonly describesData?: boolean;
	/** Whether the page gives a control that pauses or stops the chart's motion. */
	readonly pausesMotion?: boolean;
}

/** The caller's rule settings, by rule id, the context the chart is shown in, and which rules run. */
export interface QualityOptions {
	readonly rules?: Readonly<Record<string, RuleLevel | RuleSetting>>;
	readonly context?: QualityContext;
	/**
	 * The rules that run, by rule id or impact (`misleads`, `excludes`, `omits`, `risks`); every other
	 * rule is `off` (CG-06-02 part 4b). `rules` shapes the selected ones; a level never adds a rule.
	 */
	readonly ruleset?: readonly string[];
}

/** Options the review cannot use: every problem, each naming where it is (`options.rules["bar-baseline"].level`). */
export class QualityOptionsError extends TypeError {
	override readonly name = 'QualityOptionsError';
	readonly problems: readonly string[];

	constructor(problems: readonly string[]) {
		super(`Invalid quality options:\n${problems.map((problem) => `  ${problem}`).join('\n')}`);
		this.problems = problems;
	}
}

/** A context background as checked: a known colour per scheme the caller names. */
export interface CheckedBackground {
	readonly light: string | undefined;
	readonly dark: string | undefined;
}

/** Options as the review uses them: read once, own data properties only, getters never run. */
export interface Settings {
	readonly levels: ReadonlyMap<string, RuleLevel>;
	/** The ids of the rules `ruleset` selects; undefined: every rule. */
	readonly selected: ReadonlySet<string> | undefined;
	readonly ignores: ReadonlyMap<string, readonly Ignore[]>;
	readonly context: {
		readonly background: CheckedBackground | undefined;
		readonly describesData: boolean | undefined;
		readonly pausesMotion: boolean | undefined;
	};
}

const LEVELS: readonly RuleLevel[] = ['off', 'info', 'warning'];
const CONTEXT_FACTS: readonly ContextFact[] = ['background', 'describesData', 'pausesMotion'];
const SCHEMES = ['light', 'dark'] as const;
const IMPACTS = Object.keys(SEVERITY_OF_IMPACT) as Impact[];
const OPTION_KEYS = ['rules', 'context', 'ruleset'];

/** A rule as options name it: by id, or by its impact. */
export type RuleKey = Readonly<{ id: string; impact: Impact }>;

/** Problems found so far, each with where it is. */
type Problems = string[];

const isObject = (value: unknown): value is object => isContainer(value) && !Array.isArray(value);

/** The own data entries of an object; a getter is a problem, never run (named `[0]` in a list, as other problems are). */
function entries(value: object, at: string, problems: Problems): [string, unknown][] {
	return Object.keys(value).flatMap((key) => {
		const entry = ownDataProperty(value, key);
		if (entry.found) return [[key, entry.value] as [string, unknown]];
		const segment = Array.isArray(value) ? `[${key}]` : keySegment(key);
		problems.push(`${at}${segment}: is behind a getter, which is never run`);
		return [];
	});
}

/** Each own entry of an object; anything else is a problem. */
function objectEntries(value: unknown, at: string, problems: Problems): [string, unknown][] {
	if (isObject(value)) return entries(value, at, problems);
	problems.push(`${at}: must be an object`);
	return [];
}

function checkIgnore(value: unknown, at: string, problems: Problems): Ignore | undefined {
	const fields = new Map(objectEntries(value, at, problems));
	for (const key of fields.keys())
		if (key !== 'path' && key !== 'reason')
			problems.push(`${at}${keySegment(key)}: is not an ignore field (path, reason)`);
	const [path, reason] = [fields.get('path'), fields.get('reason')];
	const valid = typeof path === 'string' && pathSegments(path) !== undefined;
	if (!valid) problems.push(`${at}.path: must be a path in the finding notation, such as $.options.scales.y.min`);
	const explained = typeof reason === 'string' && reason.trim() !== '';
	if (!explained) problems.push(`${at}.reason: must say why the finding is ignored`);
	return valid && explained ? { path, reason } : undefined;
}

function checkIgnores(value: unknown, at: string, problems: Problems): Ignore[] {
	if (!Array.isArray(value)) {
		problems.push(`${at}: must be a list of { path, reason }`);
		return [];
	}
	return entries(value, at, problems).flatMap(([index, item]) => checkIgnore(item, `${at}[${index}]`, problems) ?? []);
}

const isLevel = (value: unknown): value is RuleLevel => LEVELS.some((level) => level === value);

function levelProblem(at: string): string {
	return `${at}: must be one of ${LEVELS.join(', ')} (quality findings are advisory: never error)`;
}

/** A level written alone: `'off'`, `'info'` or `'warning'`. */
function checkLevel(value: unknown, at: string, problems: Problems): { level?: RuleLevel; ignore: Ignore[] } {
	if (isLevel(value)) return { level: value, ignore: [] };
	problems.push(levelProblem(at));
	return { ignore: [] };
}

/** One rule's setting: a level, or `{ level, ignore }`. */
function checkRule(value: unknown, at: string, problems: Problems): { level?: RuleLevel; ignore: Ignore[] } {
	if (!isObject(value)) return checkLevel(value, at, problems);
	const fields = new Map(entries(value, at, problems));
	for (const key of fields.keys())
		if (key !== 'level' && key !== 'ignore')
			problems.push(`${at}${keySegment(key)}: is not a rule setting (level, ignore)`);
	const level = fields.get('level');
	if (level !== undefined && !isLevel(level)) problems.push(levelProblem(`${at}.level`));
	const ignore = fields.has('ignore') ? checkIgnores(fields.get('ignore'), `${at}.ignore`, problems) : [];
	return { ...(isLevel(level) ? { level } : {}), ignore };
}

/** A colour the contrast rule can measure against: hex or `rgb()`, opaque. */
function checkColor(value: unknown, at: string, problems: Problems): string | undefined {
	if (typeof value === 'string' && contrastRatio('#000', value) !== undefined) return value;
	problems.push(`${at}: must be an opaque hex or rgb() colour`);
	return undefined;
}

function checkBackground(value: unknown, at: string, problems: Problems): CheckedBackground | undefined {
	if (typeof value === 'string') {
		const color = checkColor(value, at, problems);
		return color === undefined ? undefined : { light: color, dark: color };
	}
	const fields = new Map(objectEntries(value, at, problems));
	for (const key of fields.keys())
		if (!SCHEMES.some((scheme) => scheme === key))
			problems.push(`${at}${keySegment(key)}: is not a colour scheme (light, dark)`);
	if (fields.size === 0 && isObject(value)) problems.push(`${at}: must name a colour for light, dark or both`);
	const [light, dark] = SCHEMES.map((scheme) =>
		fields.has(scheme) ? checkColor(fields.get(scheme), `${at}.${scheme}`, problems) : undefined
	);
	return { light, dark };
}

function checkFlag(value: unknown, at: string, problems: Problems): boolean | undefined {
	if (typeof value === 'boolean') return value;
	problems.push(`${at}: must be true or false`);
	return undefined;
}

function checkContext(value: unknown, problems: Problems): Settings['context'] {
	const fields = new Map(objectEntries(value, 'options.context', problems));
	for (const key of fields.keys())
		if (!CONTEXT_FACTS.some((fact) => fact === key))
			problems.push(`options.context${keySegment(key)}: is not a context fact (${CONTEXT_FACTS.join(', ')})`);
	const flag = (key: 'describesData' | 'pausesMotion'): boolean | undefined =>
		fields.has(key) ? checkFlag(fields.get(key), `options.context.${key}`, problems) : undefined;
	return {
		background: fields.has('background')
			? checkBackground(fields.get('background'), 'options.context.background', problems)
			: undefined,
		describesData: flag('describesData'),
		pausesMotion: flag('pausesMotion')
	};
}

const NO_CONTEXT: Settings['context'] = { background: undefined, describesData: undefined, pausesMotion: undefined };

function checkRules(value: unknown, ids: readonly string[], problems: Problems): Pick<Settings, 'levels' | 'ignores'> {
	const levels = new Map<string, RuleLevel>();
	const ignores = new Map<string, readonly Ignore[]>();
	for (const [id, setting] of objectEntries(value, 'options.rules', problems)) {
		const at = `options.rules${keySegment(id)}`;
		if (!ids.includes(id)) {
			problems.push(`${at}: is not a rule id (${ids.join(', ')})`);
			continue;
		}
		const { level, ignore } = checkRule(setting, at, problems);
		if (level !== undefined) levels.set(id, level);
		if (ignore.length > 0) ignores.set(id, ignore);
	}
	return { levels, ignores };
}

/** The rule ids one `ruleset` entry names: a rule by its id, or every rule of an impact; a hole or a getter is a problem. */
function selectedBy(list: readonly unknown[], index: number, rules: readonly RuleKey[], problems: Problems): string[] {
	const at = `options.ruleset[${String(index)}]`;
	const entry = ownDataProperty(list, String(index));
	if (!entry.found) {
		problems.push(`${at}: ${index in list ? 'is behind a getter, which is never run' : 'is missing'}`);
		return [];
	}
	const named = rules.filter(({ id, impact }) => entry.value === id || entry.value === impact);
	if (named.length === 0)
		problems.push(`${at}: is not a rule id or impact (${[...IMPACTS, ...rules.map(({ id }) => id)].join(', ')})`);
	return named.map(({ id }) => id);
}

/** The ids `ruleset` selects: each entry a rule id or an impact, at least one. */
function checkRuleset(value: unknown, rules: readonly RuleKey[], problems: Problems): Set<string> {
	if (!Array.isArray(value)) {
		problems.push('options.ruleset: must be a list of rule ids and impacts');
		return new Set();
	}
	if (value.length === 0) problems.push('options.ruleset: must name at least one rule id or impact');
	// By index, never by iterating the list: that would skip a hole (a list of holes would select nothing) and run a getter.
	const indices = Array.from({ length: value.length }, (_unused, index) => index);
	return new Set(indices.flatMap((index) => selectedBy(value, index, rules, problems)));
}

/**
 * The options as the review uses them, for the `rules`. Throws `QualityOptionsError` listing every
 * problem: an unknown rule id or context fact, a level that is not `off`, `info` or `warning`, an
 * ignore without a path in the finding notation or without a reason, a colour that is not opaque hex or
 * `rgb()`, a ruleset that names nothing or names something that is not a rule id or impact, anything
 * behind a getter.
 */
export function checkQualityOptions(value: unknown, rules: readonly RuleKey[]): Settings {
	if (value === undefined) return { levels: new Map(), selected: undefined, ignores: new Map(), context: NO_CONTEXT };
	const problems: Problems = [];
	const fields = new Map(objectEntries(value, 'options', problems));
	for (const key of fields.keys())
		if (!OPTION_KEYS.includes(key))
			problems.push(`options${keySegment(key)}: is not an option (${OPTION_KEYS.join(', ')})`);
	const checked = fields.has('rules')
		? checkRules(
				fields.get('rules'),
				rules.map(({ id }) => id),
				problems
			)
		: { levels: new Map(), ignores: new Map() };
	const context = fields.has('context') ? checkContext(fields.get('context'), problems) : NO_CONTEXT;
	const selected = fields.has('ruleset') ? checkRuleset(fields.get('ruleset'), rules, problems) : undefined;
	if (problems.length > 0) throw new QualityOptionsError(problems);
	return { ...checked, selected, context };
}
