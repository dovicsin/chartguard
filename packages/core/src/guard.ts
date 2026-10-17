import type { ValidationResult } from './diagnostic.js';
import { isConfirmedError } from './result.js';

export type ConfigValidator = (config: unknown) => ValidationResult;
export type ValidationReporter = (validation: ValidationResult) => void;
export type ValidateBeforeCreate = <T>(
	config: unknown,
	create: (value: unknown) => T,
	report?: ValidationReporter
) => T;

/** Never monkey-patches global APIs. Caller owns the original factory and side effects. */
export function createValidateBeforeCreate(library: string, validate: ConfigValidator): ValidateBeforeCreate {
	return (config, create, report) => {
		const checked = validate(config);
		report?.(checked);
		if (!checked.valid) {
			const paths = checked.diagnostics.filter(isConfirmedError).map((diagnostic) => diagnostic.path);
			throw new Error(`${library} config invalid: ${paths.join(', ')}`);
		}
		return create(config);
	};
}
