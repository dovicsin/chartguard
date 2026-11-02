import { isRecord } from '@chartguard/core';

import { InputError } from './errors.js';
import { readJson } from './input.js';

/**
 * The plugin schemas `--plugin-schema` names (CG-06-02 part 4c): each file holds one extension or a
 * list of them, as JSON data. Their shape is the extension policy's to judge (`ExtensionError`, C6);
 * a file holding anything else is the user's input error, named by its file.
 */
export interface PluginSchemas {
	readonly files: readonly string[];
	/** Every file's extensions, in the order given: one `withExtensions` call, so a name has one owner across files. */
	readonly extensions: readonly unknown[];
}

const NONE: PluginSchemas = { files: [], extensions: [] };

async function extensionsIn(file: string): Promise<unknown[]> {
	const value = await readJson(file);
	if (isRecord(value)) return [value];
	if (Array.isArray(value) && value.every(isRecord)) return value;
	throw new InputError(`${file} must hold an extension or a list of extensions ({ "id", "options", "variants" }).`);
}

export async function readPluginSchemas(files: readonly string[]): Promise<PluginSchemas> {
	if (files.length === 0) return NONE;
	const extensions: unknown[] = [];
	for (const file of files) extensions.push(...(await extensionsIn(file)));
	return { files, extensions };
}
