import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { ConfigValidator } from '@chartguard/core';
import { localSchemaPath, otherBuild } from '@chartguard/schema-generator/paths';

import { InputError, RunInputError } from './errors.js';
import { findInstall } from './installed.js';
import { type HighchartsAdapter, type Library, loadConfigAdapter } from './libraries.js';
import type { PluginSchemas } from './plugins.js';

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

/**
 * A validator built with the plugin schemas: an extension the policy refuses is the user's input,
 * with every problem (C6). The extensions are untrusted JSON: the policy checks their shape.
 */
function extended<T>(
	plugins: PluginSchemas,
	ExtensionError: new (problems: readonly string[]) => Error,
	build: (extensions: readonly never[]) => T
): T {
	try {
		return build(plugins.extensions as never[]);
	} catch (error) {
		if (error instanceof ExtensionError)
			throw new RunInputError(`--plugin-schema ${plugins.files.join(', ')}: ${error.message}`);
		throw error;
	}
}

/**
 * The Highcharts validator over a built schema, with the plugin schemas: a refused extension is the
 * user's input (C6); a schema that does not load, or that another generator or compiler built, is the
 * user's to rebuild (CG-07-06).
 */
async function generatedValidator(path: string, text: string, plugins: PluginSchemas): Promise<ConfigValidator> {
	const adapter = (await import('@chartguard/config-highcharts')) as HighchartsAdapter;
	try {
		const artifact: unknown = JSON.parse(text);
		const other = otherBuild(artifact);
		if (other !== undefined) throw rebuild(path, 'highcharts', other);
		return extended(plugins, adapter.ExtensionError, (extensions) => adapter.createValidator(artifact, { extensions }));
	} catch (error) {
		if (error instanceof InputError) throw error;
		throw rebuild(path, 'highcharts', error instanceof Error ? error.message : String(error));
	}
}

/** A shipped adapter's validator, extended with the plugin schemas when there are any. */
async function shippedValidator(library: Library, plugins: PluginSchemas): Promise<ConfigValidator> {
	const adapter = await loadConfigAdapter(library);
	const { withExtensions } = adapter;
	if (plugins.extensions.length === 0) return adapter.validate;
	if (withExtensions === undefined)
		throw new RunInputError(
			`--plugin-schema needs the full ${library} schema: run \`chartguard schema build --library ${library}\` (the curated subset has no extension points).`
		);
	return extended(plugins, adapter.ExtensionError, withExtensions);
}

/**
 * The schema for `library` as installed for the project that contains `file`, and how to build its
 * validator, which is built only when asked (a cached result needs none, CG-06-02 part 4d). `identity`
 * names exactly the schema: the kind, and a built schema's content.
 */
export interface FoundSchema {
	readonly schema: SchemaSource;
	readonly identity: string;
	readonly validator: () => Promise<ConfigValidator>;
}

/** Built once, when first asked. */
function once<T>(make: () => Promise<T>): () => Promise<T> {
	let made: Promise<T> | undefined;
	return () => (made ??= make());
}

/**
 * A library whose schema cannot ship uses the schema built for exactly the installed version, else
 * its curated subset; a schema built for another version is never used. Plugin schemas extend it
 * (CG-06-02 part 4c); the curated subset refuses them rather than drop them.
 */
async function findSchema(library: Library, file: string, plugins: PluginSchemas): Promise<FoundSchema> {
	const shipped = once(() => shippedValidator(library, plugins));
	if (!BUILT_LOCALLY.has(library)) return { schema: SHIPPED, identity: 'shipped', validator: shipped };
	const install = await findInstall(library, file);
	const path = install === undefined ? undefined : localSchemaPath(install.root, library, install.version);
	const text = path === undefined ? undefined : await readSchema(path);
	if (install === undefined || path === undefined || text === undefined)
		return { schema: CURATED, identity: 'curated', validator: shipped };
	return {
		schema: { kind: 'generated', path, version: install.version },
		identity: `generated ${createHash('sha256').update(text).digest('hex')}`,
		validator: once(() => generatedValidator(path, text, plugins))
	};
}

/**
 * The schemas of one run: found once per project install (`node_modules` root), each validator
 * built once, however many files share it.
 */
export function schemaFinder(library: Library, plugins: PluginSchemas): (file: string) => Promise<FoundSchema> {
	const found = new Map<string, Promise<FoundSchema>>();
	return async (file) => {
		const root = BUILT_LOCALLY.has(library) ? ((await findInstall(library, file))?.root ?? '') : '';
		let schema = found.get(root);
		if (schema === undefined) {
			schema = findSchema(library, file, plugins);
			found.set(root, schema);
		}
		return schema;
	};
}

/** The validator for `library` as installed for the project that contains `file`, with the plugin schemas. */
export async function loadConfigValidator(
	library: Library,
	file: string,
	plugins: PluginSchemas = { files: [], extensions: [] }
): Promise<LoadedValidator> {
	const { schema, validator } = await findSchema(library, file, plugins);
	return { validate: await validator(), schema };
}

/** A line naming the plugin extensions a result was checked with, when there are any. */
export function pluginNote(extensions: readonly string[] | undefined): string | undefined {
	return extensions === undefined || extensions.length === 0 ? undefined : `  plugins: ${extensions.join(', ')}`;
}

/** A line saying which schema checked the config; the shipped schemas need no note. */
export function schemaNote(schema: SchemaSource, library: string): string | undefined {
	if (schema.kind === 'generated') return `  schema: built from your ${library} ${schema.version} (${schema.path})`;
	if (schema.kind === 'curated')
		return `  schema: curated subset; for the full schema run \`chartguard schema build --library ${library}\``;
	return undefined;
}
