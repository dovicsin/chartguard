## @chartguard/core

### Confidence
type Confidence = 'certain' | 'inferred' | 'unknown';

### ConfigValidationError
class ConfigValidationError extends Error {
    readonly result: ValidationResult;
    readonly name = "ConfigValidationError";
    constructor(library: string, result: ValidationResult);
}

### ConfigValidator
type ConfigValidator = (config: unknown, options?: ValidationOptions) => ValidationResult;

### Coverage
type Coverage = 'partial' | 'full';

### Diagnostic
interface Diagnostic {
    code: string;
    severity: Severity;
    message: string;
    path: string;
    ruleId?: string;
    suggestion?: string;
    documentationUrl?: string;
    fix?: Fix;
    confidence: Confidence;
    file?: string;
    line?: number;
    column?: number;
    endLine?: number;
    endColumn?: number;
}

### Fix
type Fix = KeyRename | OptionEdit;

### FixError
class FixError extends Error {
    readonly name = "FixError";
}

### JsonNode
type JsonNode = (JsonSpan & {
    readonly kind: 'scalar';
}) | (JsonSpan & {
    readonly kind: 'array';
    readonly items: readonly JsonNode[];
}) | (JsonSpan & {
    readonly kind: 'object';
    readonly entries: ReadonlyMap<string, JsonNode>;
});

### JsonSource
type JsonSource = {
    readonly ok: true;
    readonly root: JsonNode;
} | {
    readonly ok: false;
    readonly message: string;
    readonly offset: number;
    readonly line: number;
    readonly column: number;
};

### JsonSpan
interface JsonSpan {
    readonly start: number;
    readonly end: number;
    readonly line: number;
    readonly column: number;
    readonly endLine: number;
    readonly endColumn: number;
}

### KeyRename
interface KeyRename {
    readonly kind: 'rename-key';
    readonly to: string;
}

### OptionEdit
interface OptionEdit {
    readonly kind: 'set-option';
    readonly path: string;
    readonly from?: OptionValue;
    readonly value: OptionValue;
    readonly effect: string;
}

### OptionValue
type OptionValue = string | number | boolean | null;

### OwnProperty
type OwnProperty = {
    readonly found: true;
    readonly value: unknown;
} | {
    readonly found: false;
    readonly accessor: boolean;
};

### QualityReport
interface QualityReport {
    readonly library: string;
    readonly rulesVersion: string;
    readonly diagnostics: readonly Diagnostic[];
    readonly suppressed: readonly Suppression[];
    readonly disabled: readonly string[];
}

### RegistryContext
interface RegistryContext {
    readonly names: readonly string[];
    readonly complete: boolean;
}

### Severity
type Severity = 'error' | 'warning' | 'info';

### SuggestionBudget
class SuggestionBudget {
    private left;
    constructor(left: number);
    get cells(): number;
    spend(cells: number): boolean;
}

### Suppression
interface Suppression {
    readonly diagnostic: Diagnostic;
    readonly by: 'setting' | 'context';
    readonly reason: string;
}

### ValidateBeforeCreate
type ValidateBeforeCreate = <T>(config: unknown, create: (value: unknown) => T, report?: ValidationReporter, options?: ValidationOptions) => T;

### ValidationOptions
interface ValidationOptions {
    readonly incomplete?: boolean;
    readonly libraryVersion?: string;
    readonly registries?: Readonly<Record<string, RegistryContext>>;
}

### ValidationReporter
type ValidationReporter = (validation: ValidationResult) => void;

### ValidationResult
interface ValidationResult {
    valid: boolean;
    status: ValidationStatus;
    library: string;
    schemaVersion: string;
    schemaDigest?: string;
    extensions?: string[];
    coverage: Coverage;
    diagnostics: Diagnostic[];
}

### ValidationStatus
type ValidationStatus = 'valid' | 'invalid' | 'partial';

### applyFix
function applyFix(config: unknown, fix: Fix, path?: string): unknown;

### createValidateBeforeCreate
function createValidateBeforeCreate(library: string, validate: ConfigValidator): ValidateBeforeCreate;

### isConfirmedError
function isConfirmedError(diagnostic: Diagnostic): boolean;

### isContainer
function isContainer(value: unknown): value is object;

### isRecord
function isRecord(value: unknown): value is Record<string, unknown>;

### keySegment
function keySegment(key: string): string;

### locateJsonKey
function locateJsonKey(object: JsonNode, key: string): JsonSpan | undefined;

### locateJsonPath
function locateJsonPath(root: JsonNode, path: string): JsonSpan & {
    readonly exact: boolean;
};

### ownDataProperty
function ownDataProperty(target: object, key: string): OwnProperty;

### parseJsonSource
function parseJsonSource(text: string): JsonSource;

### pathSegments
function pathSegments(path: string): (string | number)[] | undefined;

### result
function result(library: string, schemaVersion: string, coverage: Coverage, diagnostics: Diagnostic[]): ValidationResult;

### suggestion
function suggestion(input: string, candidates: readonly string[], budget?: SuggestionBudget): string | undefined;

### suggestionBudget
function suggestionBudget(cells?: number): SuggestionBudget;
