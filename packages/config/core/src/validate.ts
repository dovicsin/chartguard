import { result, type ValidationOptions, type ValidationResult } from '@chartguard/core';

import type { SchemaManifest } from './schema.js';
import { ConfigWalker } from './walker.js';

export function validateConfig(
	input: unknown,
	manifest: SchemaManifest,
	options: ValidationOptions = {}
): ValidationResult {
	const walker = new ConfigWalker(manifest, options);
	walker.walk(input, manifest.root);
	const coverage = options.incomplete === true ? 'partial' : manifest.coverage;
	const checked = result(manifest.library, manifest.version, coverage, walker.diagnostics);
	return manifest.digest === undefined ? checked : { ...checked, schemaDigest: manifest.digest };
}
