import { type Diagnostic, result, type ValidationOptions, type ValidationResult } from '@chartguard/core';

import { unresolved } from './diagnostics.js';
import { readRegistries, type Registries } from './registry.js';
import { type ConfigRule, ruleContext } from './rules.js';
import type { SchemaManifest } from './schema.js';
import { type Compatibility, compatibility } from './version.js';
import { ConfigWalker } from './walker.js';

/** What one validation consults besides the input and the schema. */
interface Context {
	readonly options: ValidationOptions;
	readonly registries: Registries;
	readonly rules: readonly ConfigRule[];
}

/** The schema's findings, then the rules' findings over several options at once. */
function walk(input: unknown, manifest: SchemaManifest, { options, registries, rules }: Context): Diagnostic[] {
	const walker = new ConfigWalker(manifest, options, registries);
	walker.walk(input, manifest.root);
	const context = ruleContext(options.incomplete === true, registries);
	return [...walker.diagnostics, ...rules.flatMap((rule) => rule.check(input, context))];
}

/**
 * A finding from a schema for another version is undecided for this one (A18): a confirmed error is a
 * warning, and no finding stays certain (a deprecation or an ignored option may differ between
 * versions). A fix is not offered: it was verified against the schema's version only.
 */
function asUnresolved({ fix: _fix, ...diagnostic }: Diagnostic): Diagnostic {
	return {
		...diagnostic,
		severity: diagnostic.severity === 'error' ? 'warning' : diagnostic.severity,
		confidence: 'unknown'
	};
}

/**
 * The diagnostics for `input` given the version the caller runs (CG-01-07): unchanged when it is
 * the schema's version or not given; downgraded for another minor or patch; not validated at all
 * for another major or a version that is not exact.
 */
function versionedDiagnostics(
	input: unknown,
	manifest: SchemaManifest,
	context: Context,
	fit: Compatibility | undefined
): Diagnostic[] {
	const requested = context.options.libraryVersion;
	if (requested === undefined || fit === undefined) return walk(input, manifest, context);
	const schema = `${manifest.library} ${manifest.version}`;
	switch (fit) {
		case 'exact':
			return walk(input, manifest, context);
		case 'same-major': {
			const note = `Validated against ${schema}; ${requested} may accept or reject options differently, so confirmed errors are reported as warnings and no finding is certain.`;
			return [unresolved('CFG_VERSION_MISMATCH', '$', note), ...walk(input, manifest, context).map(asUnresolved)];
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

/** Validates `input` against the schema, then the adapter's `rules` over several options at once. */
export function validateConfig(
	input: unknown,
	manifest: SchemaManifest,
	options: ValidationOptions = {},
	rules: readonly ConfigRule[] = []
): ValidationResult {
	const reading = readRegistries(options.registries, manifest.root);
	const context = { options, registries: reading.registries, rules };
	const { libraryVersion } = options;
	const fit = libraryVersion === undefined ? undefined : compatibility(manifest.version, libraryVersion);
	const diagnostics = [...reading.diagnostics, ...versionedDiagnostics(input, manifest, context, fit)];
	const versionDiffers = fit !== undefined && fit !== 'exact';
	const coverage = options.incomplete === true || versionDiffers ? 'partial' : manifest.coverage;
	const checked = result(manifest.library, manifest.version, coverage, diagnostics);
	const ids = manifest.extensions?.list.map(({ id }) => id);
	const digest = manifest.digest === undefined ? {} : { schemaDigest: manifest.digest };
	return { ...checked, ...digest, ...(ids === undefined ? {} : { extensions: ids }) };
}
