## @chartguard/source-checks

### ChartGuardSettings
interface ChartGuardSettings {
    readonly libraryVersion: Partial<Record<ChartLibrary, string>>;
    readonly registries: ValidationOptions['registries'];
    readonly extensions: Partial<Record<ChartLibrary, readonly unknown[]>>;
    readonly patterns: readonly ChartPattern[];
    readonly quality: QualityOptions | undefined;
    readonly project: boolean | string;
}

### FindingKind
type FindingKind = 'valid-config' | 'config-warnings' | 'chart-quality';

### KIND_DOCUMENTATION
KIND_DOCUMENTATION: Readonly<Record<FindingKind, string>>

### SettingsError
class SettingsError extends Error {
    readonly prefix: string;
    readonly problems: readonly string[];
    readonly name = "SettingsError";
    constructor(prefix: string, problems: readonly string[]);
}

### SourceChecker
class SourceChecker {
    private readonly prefix;
    readonly settings: ChartGuardSettings;
    private readonly validators;
    private readonly sessions;
    constructor(given: unknown, prefix: string);
    check(text: string, fileName: string, cwd: string): SourceFinding[];
    private engineFor;
    private extracted;
}

### SourceFinding
interface SourceFinding {
    readonly kind: FindingKind;
    readonly code: string;
    readonly path: string;
    readonly message: string;
    readonly start: number;
    readonly end: number;
    readonly documentationUrl?: string;
    readonly fix?: TextEdit;
    readonly suggestion?: {
        readonly description: string;
        readonly edit: TextEdit;
    };
}

### TextEdit
interface TextEdit {
    readonly start: number;
    readonly end: number;
    readonly text: string;
}

## @chartguard/source-checks/text

### Engine
interface Engine {
    validate(library: ChartLibrary, config: unknown, options: ValidationOptions): ValidationResult;
    review(library: ChartLibrary, config: unknown): QualityReport;
}

### FindingKind
type FindingKind = 'valid-config' | 'config-warnings' | 'chart-quality';

### SourceFinding
interface SourceFinding {
    readonly kind: FindingKind;
    readonly code: string;
    readonly path: string;
    readonly message: string;
    readonly start: number;
    readonly end: number;
    readonly documentationUrl?: string;
    readonly fix?: TextEdit;
    readonly suggestion?: {
        readonly description: string;
        readonly edit: TextEdit;
    };
}

### TextCheck
interface TextCheck {
    readonly readable: boolean;
    readonly uses: readonly ChartUse[];
    readonly findings: readonly SourceFinding[];
}

### TextEdit
interface TextEdit {
    readonly start: number;
    readonly end: number;
    readonly text: string;
}

### checkText
function checkText(text: string, fileName: string, engine: Engine): TextCheck;
