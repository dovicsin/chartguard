/** How serious a finding is; only `error` is a confirmed error that makes a result invalid. */
export type Severity = 'error' | 'warning' | 'info';
/**
 * `invalid`: at least one confirmed error; `partial`: none, but coverage is partial or a finding is not
 * `certain`; `valid`: none, full coverage and every finding certain.
 */
export type ValidationStatus = 'valid' | 'invalid' | 'partial';
/**
 * How sure a finding is: `certain`, `inferred` (a likely problem read from a schema fact that is not
 * authoritative) or `unknown` (could not be decided). Anything but `certain` keeps a result from `valid`.
 */
export type Confidence = 'certain' | 'inferred' | 'unknown';
/** Whether the schema checked the whole config (`full`) or only what it describes (`partial`). */
export type Coverage = 'partial' | 'full';

/**
 * A behaviour-preserving edit a tool may apply to the reported key: the runtime already reads the
 * key under its new name (a rename it performs itself), and the new name is not set yet.
 */
export interface KeyRename {
	readonly kind: 'rename-key';
	readonly to: string;
}

/** An option value an edit reads or writes: JSON's primitives. */
export type OptionValue = string | number | boolean | null;

/**
 * An edit that changes what is drawn, to what a quality finding asks (CG-05-06): set the option at
 * `path` (the finding notation) to `value`. It holds `from` when the finding was made, or nothing
 * when `from` is absent; `applyFix` refuses it once that is no longer so. `effect` says what changes.
 * Never applied without the user: unlike `rename-key`, it does not preserve behaviour.
 */
export interface OptionEdit {
	readonly kind: 'set-option';
	readonly path: string;
	readonly from?: OptionValue;
	readonly value: OptionValue;
	readonly effect: string;
}

/** An edit a finding offers: a behaviour-preserving `rename-key`, or a `set-option` that changes what is drawn. */
export type Fix = KeyRename | OptionEdit;

/**
 * One finding at `path` (the finding notation, `$.series[0].type`), with its `code`, `severity` and
 * `confidence`; `file`, `line` and `column` locate it when it was read from source.
 */
export interface Diagnostic {
	code: string;
	severity: Severity;
	message: string;
	path: string;
	ruleId?: string;
	suggestion?: string;
	documentationUrl?: string;
	/**
	 * `rename-key`: present only when applying it cannot change what the runtime does, so a tool may
	 * apply it. `set-option`: changes what is drawn, as the finding asks, offered only when the edit was
	 * verified to resolve the finding without a new one; apply it only at the user's request.
	 */
	fix?: Fix;
	confidence: Confidence;
	file?: string;
	line?: number;
	column?: number;
	/** Where the source range the finding is about ends (exclusive), when it is known (CG-03-07). */
	endLine?: number;
	endColumn?: number;
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

/** What the caller knows about its input and runtime, passed to every validation. */
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

/**
 * The outcome of one validation. `valid` and `status` are derived from `coverage` and `diagnostics` by
 * `result()` only, never assembled by hand.
 */
export interface ValidationResult {
	/** No confirmed errors; read `status` for completeness. */
	valid: boolean;
	status: ValidationStatus;
	library: string;
	/** The upstream version the schema describes. */
	schemaVersion: string;
	/** The exact schema artifact that produced this result (`sha256-…`), when it is generated. */
	schemaDigest?: string;
	/** The plugin extensions the schema was extended with (CG-02-05), by id. */
	extensions?: string[];
	coverage: Coverage;
	diagnostics: Diagnostic[];
}

/**
 * A finding that was not reported, and why: the caller's settings ignore it at its path (`setting`),
 * or the context the caller declares meets the rule's concern (`context`). It is kept, never dropped.
 */
export interface Suppression {
	readonly diagnostic: Diagnostic;
	readonly by: 'setting' | 'context';
	readonly reason: string;
}

/** Advisory findings about a chart's presentation. Never a verdict: there is no `valid` and no error severity. */
export interface QualityReport {
	readonly library: string;
	readonly rulesVersion: string;
	readonly diagnostics: readonly Diagnostic[];
	/** Findings the caller's settings or context suppressed, in rule order. */
	readonly suppressed: readonly Suppression[];
	/** The rules the caller's settings turned off, by id: they did not run. */
	readonly disabled: readonly string[];
}
