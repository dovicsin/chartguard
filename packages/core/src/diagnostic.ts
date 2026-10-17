export type Severity = 'error' | 'warning' | 'info';
export type ValidationStatus = 'valid' | 'invalid' | 'partial';
export type Confidence = 'certain' | 'inferred' | 'unknown';
export type Coverage = 'partial' | 'full';

export interface Diagnostic {
	code: string;
	severity: Severity;
	message: string;
	path: string;
	ruleId?: string;
	suggestion?: string;
	documentationUrl?: string;
	confidence: Confidence;
	file?: string;
	line?: number;
	column?: number;
}

export interface ValidationResult {
	/** No confirmed errors; read `status` for completeness. */
	valid: boolean;
	status: ValidationStatus;
	library: string;
	schemaVersion: string;
	coverage: Coverage;
	diagnostics: Diagnostic[];
}
