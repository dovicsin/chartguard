/** The commands and options of the CLI: which option each command takes (C4), shared by the command line and the config file. */
export const CONFIG_COMMANDS = ['validate', 'quality', 'analyze'] as const;
export type ConfigCommand = (typeof CONFIG_COMMANDS)[number];
export type Command = ConfigCommand | 'schema';

export const FORMATS = ['text', 'json', 'sarif'] as const;
export type Format = (typeof FORMATS)[number];
export const FAIL_ON = ['error', 'warning', 'never'] as const;
export type FailOn = (typeof FAIL_ON)[number];

export const isFormat = (value: string): value is Format => FORMATS.some((format) => format === value);
export const isFailOn = (value: string): value is FailOn => FAIL_ON.some((level) => level === value);

export const OPTIONS = {
	library: { type: 'string' },
	file: { type: 'string', multiple: true },
	ignore: { type: 'string', multiple: true },
	name: { type: 'string' },
	'library-version': { type: 'string' },
	registries: { type: 'string' },
	project: { type: 'string' },
	patterns: { type: 'string' },
	settings: { type: 'string' },
	ruleset: { type: 'string', multiple: true },
	'plugin-schema': { type: 'string', multiple: true },
	cache: { type: 'boolean' },
	'cache-location': { type: 'string' },
	dir: { type: 'string' },
	json: { type: 'boolean', default: false },
	format: { type: 'string' },
	'fail-on': { type: 'string' },
	config: { type: 'string' },
	'no-config': { type: 'boolean' }
} as const;

export type OptionName = keyof typeof OPTIONS;

const ALL_COMMANDS: readonly Command[] = [...CONFIG_COMMANDS, 'schema'];

/**
 * Which commands take each option (C4): `--name`, `--project` and `--patterns` belong to `analyze`;
 * `--library-version`, `--registries` and `--plugin-schema` to the config checks, not to `quality`; `--settings` and
 * `--ruleset` to `quality` only; `--cache` and `--cache-location` to `validate` and `quality` (an analysis depends on files the cache
 * cannot list); `--dir` to `schema build`; a config file to the checks.
 */
export const OWNERS: Readonly<Record<OptionName, readonly Command[]>> = {
	library: ALL_COMMANDS,
	json: ALL_COMMANDS,
	file: CONFIG_COMMANDS,
	ignore: CONFIG_COMMANDS,
	name: ['analyze'],
	project: ['analyze'],
	patterns: ['analyze'],
	'library-version': ['validate', 'analyze'],
	registries: ['validate', 'analyze'],
	settings: ['quality'],
	ruleset: ['quality'],
	'plugin-schema': ['validate', 'analyze'],
	cache: ['validate', 'quality'],
	'cache-location': ['validate', 'quality'],
	dir: ['schema'],
	format: CONFIG_COMMANDS,
	'fail-on': CONFIG_COMMANDS,
	config: CONFIG_COMMANDS,
	'no-config': CONFIG_COMMANDS
};

export function isOptionName(name: string): name is OptionName {
	return Object.hasOwn(OPTIONS, name);
}
