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

export interface ValidationOptions {
	/**
	 * The input is a partial extraction (unresolved spreads or values were left out), so a
	 * missing required key is unresolved rather than confirmed missing, and coverage is partial.
	 */
	readonly incomplete?: boolean;
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

/** Advisory findings about a chart's presentation. Never a verdict: there is no `valid` and no error severity. */
export interface QualityReport {
	readonly library: string;
	readonly rulesVersion: string;
	readonly diagnostics: readonly Diagnostic[];
}
