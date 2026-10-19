import { readFile } from 'node:fs/promises';

import type { ConfigValidator } from '@chartguard/core';
import { localSchemaPath } from '@chartguard/schema-generator/paths';

import { InputError } from './errors.js';
import { findInstall } from './installed.js';
import { type Library, loadConfigAdapter } from './libraries.js';

/** Which schema a result came from: shipped with the adapter, the curated subset, or built from the user's install. */
export type SchemaSource =
	| { readonly kind: 'shipped' }
	| { readonly kind: 'curated' }
	| { readonly kind: 'generated'; readonly path: string; readonly version: string };

/** Libraries whose full schema cannot ship (license, CG-01-05): users build it from their own install. */
const BUILT_LOCALLY: ReadonlySet<Library> = new Set(['highcharts']);

interface LoadedValidator {
	readonly validate: ConfigValidator;
	readonly schema: SchemaSource;
}

const SHIPPED: SchemaSource = { kind: 'shipped' };
const CURATED: SchemaSource = { kind: 'curated' };

async function readSchema(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, 'utf8');
	} catch {
		return undefined;
	}
}

function rebuild(path: string, library: Library, reason: string): InputError {
	return new InputError(`${path} cannot be used: ${reason}\nRebuild it: chartguard schema build --library ${library}`);
}

/** The Highcharts validator over a built schema; a schema that does not load is the user's to rebuild. */
async function generatedValidator(path: string, text: string): Promise<ConfigValidator> {
	const { createValidator } = await import('@chartguard/config-highcharts');
	try {
		return createValidator(JSON.parse(text));
	} catch (error) {
		throw rebuild(path, 'highcharts', error instanceof Error ? error.message : String(error));
	}
}

/**
 * The validator for `library` as installed for the project that contains `file`. A library whose
 * schema cannot ship uses the schema built for exactly the installed version, else its curated
 * subset; a schema built for another version is never used.
 */
export async function loadConfigValidator(library: Library, file: string): Promise<LoadedValidator> {
	if (!BUILT_LOCALLY.has(library)) return { validate: (await loadConfigAdapter(library)).validate, schema: SHIPPED };
	const install = await findInstall(library, file);
	const path = install === undefined ? undefined : localSchemaPath(install.root, library, install.version);
	const text = path === undefined ? undefined : await readSchema(path);
	if (install === undefined || path === undefined || text === undefined)
		return { validate: (await loadConfigAdapter(library)).validate, schema: CURATED };
	return {
		validate: await generatedValidator(path, text),
		schema: { kind: 'generated', path, version: install.version }
	};
}

/** A line saying which schema checked the config; the shipped schemas need no note. */
export function schemaNote(schema: SchemaSource, library: string): string | undefined {
	if (schema.kind === 'generated') return `  schema: built from your ${library} ${schema.version} (${schema.path})`;
	if (schema.kind === 'curated')
		return `  schema: curated subset; for the full schema run \`chartguard schema build --library ${library}\``;
	return undefined;
}
