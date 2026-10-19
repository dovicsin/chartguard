import {
	type Extension,
	lowerArtifact,
	type LoweredSchema,
	type SchemaArtifact,
	validateConfig,
	withExtensions as extend
} from '@chartguard/config-core';
import type { ConfigValidator, ValidationOptions, ValidationResult } from '@chartguard/core';

import artifact from './generated/echarts-6.1.0.json' with { type: 'json' };
import { RULES } from './rules/index.js';

export { type Extension, ExtensionError } from '@chartguard/config-core';

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
	return validateConfig(input, schema().manifest, options, RULES);
}

/**
 * A validator that also checks the given plugins' options and variants: components at
 * `echarts.options` (the option root), series in the `echarts` registry (`series.wordCloud`).
 * Built-ins cannot be replaced and a name has one owner; a refused extension throws
 * `ExtensionError` here, once.
 */
export function withExtensions(extensions: readonly Extension[]): ConfigValidator {
	const manifest = extend(schema().manifest, extensions);
	return (input, options) => validateConfig(input, manifest, options, RULES);
}
