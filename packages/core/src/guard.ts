import type { ValidationOptions, ValidationResult } from './diagnostic.js';
import { isConfirmedError } from './result.js';

export type ConfigValidator = (config: unknown, options?: ValidationOptions) => ValidationResult;
export type ValidationReporter = (validation: ValidationResult) => void;
export type ValidateBeforeCreate = <T>(
	config: unknown,
	create: (value: unknown) => T,
	report?: ValidationReporter
) => T;

/** Thrown instead of creating a chart; carries the full result so callers can inspect every diagnostic. */
export class ConfigValidationError extends Error {
	override readonly name = 'ConfigValidationError';

	constructor(
		library: string,
		readonly result: ValidationResult
	) {
		const paths = result.diagnostics.filter(isConfirmedError).map((diagnostic) => diagnostic.path);
		super(`${library} config invalid: ${paths.join(', ')}`);
	}
}

/** Never monkey-patches global APIs. Caller owns the original factory and side effects. */
export function createValidateBeforeCreate(library: string, validate: ConfigValidator): ValidateBeforeCreate {
	return (config, create, report) => {
		const checked = validate(config);
		report?.(checked);
		if (!checked.valid) throw new ConfigValidationError(library, checked);
		return create(config);
	};
}
