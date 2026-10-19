import { type Diagnostic, result, type ValidationOptions, type ValidationResult } from '@chartguard/core';

import { unresolved } from './diagnostics.js';
import { readRegistries, type Registries } from './registry.js';
import type { SchemaManifest } from './schema.js';
import { compatibility } from './version.js';
import { ConfigWalker } from './walker.js';

function walk(
	input: unknown,
	manifest: SchemaManifest,
	options: ValidationOptions,
	registries: Registries
): Diagnostic[] {
	const walker = new ConfigWalker(manifest, options, registries);
	walker.walk(input, manifest.root);
	return walker.diagnostics;
}

/** A confirmed error from a schema for another version is only a likely problem for this one. */
function asUnresolved(diagnostic: Diagnostic): Diagnostic {
	return diagnostic.severity === 'error' ? { ...diagnostic, severity: 'warning', confidence: 'unknown' } : diagnostic;
}

/**
 * The diagnostics for `input` given the version the caller runs (CG-01-07): unchanged when it is
 * the schema's version or not given; downgraded for another minor or patch; not validated at all
 * for another major or a version that is not exact.
 */
function versionedDiagnostics(
	input: unknown,
	manifest: SchemaManifest,
	options: ValidationOptions,
	registries: Registries
): Diagnostic[] {
	const requested = options.libraryVersion;
	if (requested === undefined) return walk(input, manifest, options, registries);
	const schema = `${manifest.library} ${manifest.version}`;
	switch (compatibility(manifest.version, requested)) {
		case 'exact':
			return walk(input, manifest, options, registries);
		case 'same-major': {
			const note = `Validated against ${schema}; ${requested} may accept or reject options differently, so confirmed errors are reported as warnings.`;
			return [
				unresolved('CFG_VERSION_MISMATCH', '$', note),
				...walk(input, manifest, options, registries).map(asUnresolved)
			];
		}
		case 'other-major':
			return [
				unresolved(
					'CFG_UNSUPPORTED_VERSION',
					'$',
					`${requested} is not supported: this schema describes ${schema}. Not validated.`
				)
			];
		case 'malformed':
			return [
				unresolved(
					'CFG_UNSUPPORTED_VERSION',
					'$',
					`"${requested}" is not an exact version (MAJOR.MINOR.PATCH). Not validated.`
				)
			];
	}
}

export function validateConfig(
	input: unknown,
	manifest: SchemaManifest,
	options: ValidationOptions = {}
): ValidationResult {
	const context = readRegistries(options.registries, manifest.root);
	const diagnostics = [...context.diagnostics, ...versionedDiagnostics(input, manifest, options, context.registries)];
	const { libraryVersion } = options;
	const versionDiffers = libraryVersion !== undefined && compatibility(manifest.version, libraryVersion) !== 'exact';
	const coverage = options.incomplete === true || versionDiffers ? 'partial' : manifest.coverage;
	const checked = result(manifest.library, manifest.version, coverage, diagnostics);
	return manifest.digest === undefined ? checked : { ...checked, schemaDigest: manifest.digest };
}
