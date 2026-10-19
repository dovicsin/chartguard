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

/**
 * What the caller's runtime has registered in one registry (CG-02-04). `complete`: `names` is
 * everything registered (a tree-shaken build), so anything else is rejected by the runtime.
 * Otherwise `names` are extensions known to be registered on top of the built-ins.
 */
export interface RegistryContext {
	readonly names: readonly string[];
	readonly complete: boolean;
}

export interface ValidationOptions {
	/**
	 * The input is a partial extraction (unresolved spreads or values were left out), so a
	 * missing required key is unresolved rather than confirmed missing, and coverage is partial.
	 */
	readonly incomplete?: boolean;
	/**
	 * The exact upstream version the caller runs (`4.4.1`). Another minor or patch than the
	 * schema's turns confirmed errors into warnings; another major is not validated (CG-01-07).
	 */
	readonly libraryVersion?: string;
	/** Registered names per registry id the schema uses (`echarts`, `chartjs.controllers`). */
	readonly registries?: Readonly<Record<string, RegistryContext>>;
}

export interface ValidationResult {
	/** No confirmed errors; read `status` for completeness. */
	valid: boolean;
	status: ValidationStatus;
	library: string;
	/** The upstream version the schema describes. */
	schemaVersion: string;
	/** The exact schema artifact that produced this result (`sha256-…`), when it is generated. */
	schemaDigest?: string;
	coverage: Coverage;
	diagnostics: Diagnostic[];
}

/** Advisory findings about a chart's presentation. Never a verdict: there is no `valid` and no error severity. */
export interface QualityReport {
	readonly library: string;
	readonly rulesVersion: string;
	readonly diagnostics: readonly Diagnostic[];
}
