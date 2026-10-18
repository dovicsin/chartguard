import { manifestFromArtifact, type SchemaManifest, validateConfig } from '@chartguard/config-core';
import type { ValidationResult } from '@chartguard/core';

import artifact from './generated/chartjs-4.5.1.json' with { type: 'json' };

/** Generated from the chart.js@4.5.1 type declarations by tools/schema-generator. */
export const manifest: SchemaManifest = manifestFromArtifact(artifact);

export function validate(input: unknown): ValidationResult {
	return validateConfig(input, manifest);
}
