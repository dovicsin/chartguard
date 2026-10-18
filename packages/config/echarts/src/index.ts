import { lowerArtifact, type LoweredSchema, type SchemaArtifact, validateConfig } from '@chartguard/config-core';
import type { ValidationOptions, ValidationResult } from '@chartguard/core';

import artifact from './generated/echarts-6.1.0.json' with { type: 'json' };

let lowered: LoweredSchema | undefined;

/**
 * Generated from the echarts@6.1.0 type declarations (`EChartsOption`) by tools/schema-generator.
 * The artifact's structure and provenance are verified by this package's tests before it is
 * committed, so importing the package only parses JSON; lowering happens once, on first use.
 */
export function schema(): LoweredSchema {
	lowered ??= lowerArtifact(artifact as unknown as SchemaArtifact);
	return lowered;
}

export function validate(input: unknown, options?: ValidationOptions): ValidationResult {
	return validateConfig(input, schema().manifest, options);
}
