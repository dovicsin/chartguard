import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { isRecord } from '@chartguard/core';

import { InputError } from './errors.js';
import { readJson } from './input.js';
import { isLibrary } from './libraries.js';
import {
	CONFIG_COMMANDS,
	type ConfigCommand,
	FAIL_ON,
	FORMATS,
	isFailOn,
	isFormat,
	type OptionName,
	OWNERS
} from './option-table.js';

/**
 * A project config file (CG-06-02 part 3): `chartguard.config.json` in the working directory, or
 * the file `--config` names; `--no-config` reads none. Its keys are the options of the command line,
 * at the top level and in a section per command; the command line wins, then the command's section,
 * then the top level. Paths and patterns in it are relative to the file's directory. JSON only: data,
 * never code.
 */
const DEFAULT_CONFIG = 'chartguard.config.json';

/** A config key, the option it stands for, and what it must hold. */
type Kind = 'list' | 'path' | 'patterns' | 'text';
const KEYS: Readonly<Record<string, { readonly option: OptionName; readonly kind: Kind }>> = {
	library: { option: 'library', kind: 'text' },
	files: { option: 'file', kind: 'patterns' },
	ignore: { option: 'ignore', kind: 'patterns' },
	format: { option: 'format', kind: 'text' },
	failOn: { option: 'fail-on', kind: 'text' },
	libraryVersion: { option: 'library-version', kind: 'text' },
	registries: { option: 'registries', kind: 'path' },
	settings: { option: 'settings', kind: 'path' },
	patterns: { option: 'patterns', kind: 'path' },
	project: { option: 'project', kind: 'path' },
	name: { option: 'name', kind: 'text' }
};

/** The values the file gives one command, by option name, its paths relative to the working directory. */
export type ConfigValues = Partial<Record<OptionName, string | string[]>>;

export interface ProjectConfig {
	/** The file as the user named it (or the default name). */
	readonly path: string;
	readonly valuesFor: (command: ConfigCommand) => ConfigValues;
}

/** What is wrong with one value of the file, or undefined. */
function problemOf(key: string, value: unknown): string | undefined {
	const known = KEYS[key];
	if (known === undefined) return 'unknown key';
	if (known.kind === 'patterns')
		return Array.isArray(value) && value.every((item) => typeof item === 'string')
			? undefined
			: 'must be a list of strings';
	if (typeof value !== 'string') return 'must be a string';
	return CHOICES[key]?.(value);
}

/** The keys whose string must be one of a few: what is wrong with a value, or undefined. */
const CHOICES: Readonly<Record<string, (value: string) => string | undefined>> = {
	library: (value) => (isLibrary(value) ? undefined : `unknown library '${value}' (chartjs, echarts or highcharts)`),
	format: (value) => (isFormat(value) ? undefined : `unknown format '${value}' (${FORMATS.join(', ')})`),
	failOn: (value) => (isFailOn(value) ? undefined : `unknown --fail-on '${value}' (${FAIL_ON.join(', ')})`)
};

const isCommand = (key: string): key is ConfigCommand => CONFIG_COMMANDS.some((command) => command === key);

/** Every problem of the file, each with its key path (`quality.name: …`). */
function problemsOf(file: Record<string, unknown>): string[] {
	return Object.entries(file).flatMap(([key, value]) => {
		if (!isCommand(key)) {
			const problem = problemOf(key, value);
			return problem === undefined ? [] : [`${key}: ${problem}`];
		}
		if (!isRecord(value)) return [`${key}: must be an object of ${key}'s options`];
		return Object.entries(value).flatMap(([inner, innerValue]) => {
			const option = KEYS[inner]?.option;
			if (option !== undefined && !OWNERS[option].includes(key)) return [`${key}.${inner}: not an option of ${key}`];
			const problem = problemOf(inner, innerValue);
			return problem === undefined ? [] : [`${key}.${inner}: ${problem}`];
		});
	});
}

/** A value of the file with its paths made relative to the working directory (patterns with `/`). */
function located(kind: Kind, value: string | string[], base: string): string | string[] {
	const prefix = (pattern: string): string => (base === '' ? pattern : `${base.split(sep).join('/')}/${pattern}`);
	if (kind === 'patterns' && Array.isArray(value)) return value.map(prefix);
	if (kind === 'path' && typeof value === 'string') return join(base, value);
	return value;
}

/** The options a part of the file (its top level, or a command's section) gives, by option name. */
function optionsOf(part: Record<string, unknown>, base: string): ConfigValues {
	const values: ConfigValues = {};
	for (const [key, value] of Object.entries(part)) {
		const known = KEYS[key];
		if (known !== undefined && (typeof value === 'string' || Array.isArray(value)))
			values[known.option] = located(known.kind, value as string | string[], base);
	}
	return values;
}

/** `--config <path>` (or `--config=<path>`) as given, before any `--`. */
function configArgument(argv: readonly string[]): string | undefined {
	const end = argv.indexOf('--');
	const args = end === -1 ? argv : argv.slice(0, end);
	const index = args.indexOf('--config');
	if (index !== -1) return args[index + 1];
	return args.find((arg) => arg.startsWith('--config='))?.slice('--config='.length);
}

/**
 * The config file a check reads, or none: `--no-config` (with `--config` a usage error, reported by
 * the parser), `--config <path>` (which must exist), else the default file when the working
 * directory has one. A file that cannot be used is an input error listing every problem (C7).
 */
export async function readProjectConfig(
	argv: readonly string[],
	cwd: string = process.cwd()
): Promise<ProjectConfig | undefined> {
	const named = configArgument(argv);
	if (argv.includes('--no-config')) return undefined;
	const path = named ?? (existsSync(resolve(cwd, DEFAULT_CONFIG)) ? DEFAULT_CONFIG : undefined);
	if (path === undefined) return undefined;
	const file = await readJson(resolve(cwd, path));
	if (!isRecord(file)) throw new InputError(`${path} must hold a JSON object of options.`);
	const problems = problemsOf(file);
	if (problems.length > 0) throw new InputError(`${path} cannot be used:\n  ${problems.join('\n  ')}`);
	const base = relative(cwd, dirname(resolve(cwd, path)));
	const top = optionsOf(file, base);
	return {
		path,
		valuesFor: (command) => {
			const section = file[command];
			return { ...top, ...(isRecord(section) ? optionsOf(section, base) : {}) };
		}
	};
}
