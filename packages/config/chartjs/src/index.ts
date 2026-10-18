import { lowerArtifact, type LoweredSchema, type SchemaArtifact, validateConfig } from '@chartguard/config-core';
import type { ValidationOptions, ValidationResult } from '@chartguard/core';

import artifact from './generated/chartjs-4.5.1.json' with { type: 'json' };

let lowered: LoweredSchema | undefined;

/**
 * Generated from the chart.js@4.5.1 type declarations by tools/schema-generator. The artifact's
 * structure and provenance are verified by this package's tests before it is committed, so importing
 * the package only parses JSON; lowering to the engine schema happens once, on first use.
 */
export function schema(): LoweredSchema {
	lowered ??= lowerArtifact(artifact as unknown as SchemaArtifact);
	return lowered;
}

export function validate(input: unknown, options?: ValidationOptions): ValidationResult {
	return validateConfig(input, schema().manifest, options);
}
