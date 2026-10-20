import type { ValidationOptions } from '@chartguard/core';

import { readJson } from './input.js';
import { installedVersion } from './installed.js';
import type { ConfigInvocation } from './invocation.js';

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
