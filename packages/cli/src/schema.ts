import { resolve } from 'node:path';

import { InputError } from './errors.js';
import { EXIT_OK } from './exit-codes.js';
import type { SchemaInvocation } from './invocation.js';
import type { Io } from './io.js';
import { printJson } from './report.js';

/**
 * `schema build`: generates the library's schema from the install in the project directory and
 * writes it next to that install. The generator and the TypeScript compiler load only here.
 */
export async function schemaCommand({ library, directory, json }: SchemaInvocation, io: Io): Promise<number> {
	const { buildLocalSchema, UpstreamError } = await import('@chartguard/schema-generator');
	let built: ReturnType<typeof buildLocalSchema>;
	try {
		built = buildLocalSchema(resolve(directory), library);
	} catch (error) {
		if (error instanceof UpstreamError) throw new InputError(error.message);
		throw error;
	}
	const { version, path, digest, integrity } = built;
	if (json) printJson({ mode: 'schema', library, version, path, digest, integrity }, io);
	else {
		io.out(`${library} ${built.version} schema built from your install (${built.digest.slice(0, 19)})`);
		io.out(`  ${built.path}`);
	}
	return EXIT_OK;
}
