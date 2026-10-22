import type { ValidationOptions } from '@chartguard/core';

import { InputError } from './errors.js';
import { readJson } from './input.js';
import { installedVersion } from './installed.js';
import type { ConfigInvocation } from './invocation.js';
import type { QualityAdapter, QualityOptions } from './libraries.js';

/** `--library-version auto` reads the installed package; an explicit version is passed as given. */
async function versionOptions({ library, file, libraryVersion }: ConfigInvocation): Promise<ValidationOptions> {
	if (libraryVersion === undefined) return {};
	return { libraryVersion: libraryVersion === 'auto' ? await installedVersion(library, file) : libraryVersion };
}

/**
 * The validation context the invocation gives. The registry file must be readable JSON (input
 * error otherwise); its shape is the validator's to judge, so a malformed context is a finding.
 */
export async function validationOptions(invocation: ConfigInvocation): Promise<ValidationOptions> {
	const version = await versionOptions(invocation);
	if (invocation.registries === undefined) return version;
	// Untrusted JSON: the validator reads it structurally and reports a malformed context.
	const registries = (await readJson(invocation.registries)) as NonNullable<ValidationOptions['registries']>;
	return { ...version, registries };
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
