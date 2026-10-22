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
type Fix = KeyRename;

### KeyRename
interface KeyRename {
    readonly kind: 'rename-key';
    readonly to: string;
}

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

### Suppression
interface Suppression {
    readonly diagnostic: Diagnostic;
    readonly by: 'setting' | 'context';
    readonly reason: string;
}

### ValidateBeforeCreate
type ValidateBeforeCreate = <T>(config: unknown, create: (value: unknown) => T, report?: ValidationReporter) => T;

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

### ownDataProperty
function ownDataProperty(target: object, key: string): OwnProperty;

### pathSegments
function pathSegments(path: string): (string | number)[] | undefined;

### result
function result(library: string, schemaVersion: string, coverage: Coverage, diagnostics: Diagnostic[]): ValidationResult;

### suggestion
function suggestion(input: string, candidates: readonly string[]): string | undefined;
