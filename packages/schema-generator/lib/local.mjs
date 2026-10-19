import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { generateArtifact, isRedistributable } from './generate.mjs';
import { installedUpstream, pinOf, UpstreamError } from './lock.mjs';
import { localSchemaPath } from './paths.mjs';

/**
 * Builds the schema of `library` from the project's own install and writes it next to it. Only for
 * libraries whose schema cannot ship with their adapter; the generator must find every declaration
 * shape and runtime fact it relies on in that install, or nothing is written.
 * @param {string} root
 * @param {string} library
 * @returns {{ path: string, version: string, digest: string, integrity: string }}
 */
export function buildLocalSchema(root, library) {
	if (isRedistributable(pinOf(library)))
		throw new UpstreamError(`${library} ships its schema with its adapter; there is nothing to build.`);
	const pin = installedUpstream(root, library);
	let generated;
	try {
		generated = generateArtifact(root, library, pin);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new UpstreamError(
			`${pin.package} ${pin.version} could not be read by this generator (it was verified against ${pinOf(library).version}): ${reason}`
		);
	}
	const path = localSchemaPath(root, library, pin.version);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, generated.text);
	return { path, version: pin.version, digest: generated.artifact.digest, integrity: pin.integrity };
}
