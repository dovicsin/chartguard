import type { ValidationOptions } from '@chartguard/core';

import { InputError } from './errors.js';
import { readJson } from './input.js';
import { installedVersion, type ResolvedVersion } from './installed.js';
import type { ConfigInvocation } from './invocation.js';
import type { QualityAdapter, QualityOptions } from './libraries.js';

/** The options a check validates with, and the version `--library-version auto` resolved, with its source. */
export interface CheckOptions {
	readonly options: ValidationOptions;
	readonly version: ResolvedVersion | undefined;
}

/** `--library-version auto` resolves the version (installed, else locked); an explicit version is passed as given. */
async function versionOptions({ library, file, libraryVersion }: ConfigInvocation): Promise<CheckOptions> {
	if (libraryVersion === undefined) return { options: {}, version: undefined };
	if (libraryVersion !== 'auto') return { options: { libraryVersion }, version: undefined };
	const version = await installedVersion(library, file);
	return { options: { libraryVersion: version.version }, version };
}

/**
 * The validation context the invocation gives. The registry file must be readable JSON (input
 * error otherwise); its shape is the validator's to judge, so a malformed context is a finding.
 */
export async function validationOptions(invocation: ConfigInvocation): Promise<CheckOptions> {
	const chosen = await versionOptions(invocation);
	if (invocation.registries === undefined) return chosen;
	// Untrusted JSON: the validator reads it structurally and reports a malformed context.
	const registries = (await readJson(invocation.registries)) as NonNullable<ValidationOptions['registries']>;
	return { ...chosen, options: { ...chosen.options, registries } };
}

/**
 * The rule settings and page context of `quality --settings` (CG-05-05). The file must be readable
 * JSON whose options pass the adapter's check; a malformed settings file is the user's input error, with every problem.
 */
export async function qualityOptions(
	{ settings }: ConfigInvocation,
	adapter: QualityAdapter
): Promise<QualityOptions | undefined> {
	if (settings === undefined) return undefined;
	const options = await readJson(settings);
	try {
		adapter.assertQualityOptions(options);
	} catch (error) {
		if (error instanceof adapter.QualityOptionsError) throw new InputError(`${settings}: ${error.message}`);
		throw error;
	}
	return options;
}
