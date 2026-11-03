/** The keys of `settings.chartguard` the server reads (the language server's README). */
export const KEYS = ['libraryVersion', 'registries', 'extensions', 'patterns', 'quality', 'project'] as const;

/** A configuration section as VS Code gives it: values by key, `undefined` for one nobody set. */
export interface Section {
	get(key: string): unknown;
}

/**
 * The editor's `chartguard` settings as the server reads them: only the keys it knows, and only what
 * is set. VS Code's section object carries methods, and an unset setting without a default reads as
 * `undefined` or `null`; the server checks every key it gets, so nothing else is sent (the protocol
 * sends the values as JSON). In a workspace that is
 * not trusted VS Code itself returns the user's values only (`restrictedConfigurations`).
 */
export function settingsOf(section: Section): Record<string, unknown> {
	const settings: Record<string, unknown> = {};
	for (const key of KEYS) {
		const value = section.get(key);
		if (value !== undefined && value !== null) settings[key] = value;
	}
	return settings;
}
