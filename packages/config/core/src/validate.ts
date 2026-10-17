import { result, type ValidationResult } from '@chartguard/core';

import type { SchemaManifest } from './schema.js';
import { ConfigWalker } from './walker.js';

export function validateConfig(input: unknown, manifest: SchemaManifest): ValidationResult {
	const walker = new ConfigWalker(manifest);
	walker.walk(input, manifest.root);
	return result(manifest.library, manifest.version, manifest.coverage, walker.diagnostics);
}
