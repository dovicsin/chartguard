## @chartguard/analysis-typescript

### AnalysisOutput
interface AnalysisOutput {
    readonly readable: boolean;
    readonly objects: readonly SourceObject[];
    readonly uses: readonly ChartUse[];
    readonly diagnostics: readonly Diagnostic[];
}

### Binding
type Binding = 'const' | 'let' | 'var';

### ChartLibrary
type ChartLibrary = 'chartjs' | 'echarts' | 'highcharts';

### ChartPattern
interface ChartPattern {
    readonly id: string;
    readonly library: ChartLibrary;
    readonly module?: string;
    readonly file?: string;
    readonly export: string;
    readonly argument?: number;
    readonly prop?: string;
    readonly construct?: boolean;
}

### ChartUse
interface ChartUse {
    readonly library: ChartLibrary;
    readonly pattern: string;
    readonly line: number;
    readonly column: number;
    readonly value: unknown;
    readonly complete: boolean;
    readonly diagnostics: readonly Diagnostic[];
    readonly source?: string;
    readonly paths: readonly PathFact[];
}

### ExtractOptions
interface ExtractOptions {
    readonly patterns?: readonly ChartPattern[];
}

### MAX_DECODE_STEPS
MAX_DECODE_STEPS = 100000

### MAX_FACTS
MAX_FACTS = 10000

### MAX_NESTING
MAX_NESTING = 256

### MAX_SOURCE_LENGTH
MAX_SOURCE_LENGTH = 2000000

### PathFact
interface PathFact extends SourceRange {
    readonly path: string;
    readonly known: boolean;
    readonly reason?: UnknownReason;
}

### PatternError
class PatternError extends Error {
    readonly problems: readonly string[];
    readonly name = "PatternError";
    constructor(problems: readonly string[]);
}

### SourceObject
interface SourceObject {
    readonly name: string;
    readonly line: number;
    readonly column: number;
    readonly binding: Binding;
    readonly value: unknown;
    readonly complete: boolean;
    readonly diagnostics: readonly Diagnostic[];
    readonly paths: readonly PathFact[];
}

### SourceRange
interface SourceRange {
    readonly file: string;
    readonly line: number;
    readonly column: number;
    readonly endLine: number;
    readonly endColumn: number;
}

### UnknownReason
type UnknownReason = 'call' | 'name' | 'expression' | 'computed-key' | 'spread' | 'choice' | 'mutated' | 'cycle' | 'limit';

### extractStaticConfigs
function extractStaticConfigs(source: string, filename?: string, options?: ExtractOptions): AnalysisOutput;

### rangeAt
function rangeAt(facts: readonly PathFact[], path: string): SourceRange | undefined;

## @chartguard/analysis-typescript/project

### MAX_PROJECT_FILES
MAX_PROJECT_FILES = 2000

### ProjectAnalysis
interface ProjectAnalysis extends AnalysisOutput {
    readonly fileName: string;
    readonly tsconfig: string | undefined;
}

### ProjectConfigError
class ProjectConfigError extends Error {
    readonly tsconfig: string;
    readonly problems: readonly string[];
    readonly name = "ProjectConfigError";
    constructor(tsconfig: string, problems: readonly string[]);
}

### ProjectOptions
interface ProjectOptions extends ExtractOptions {
    readonly tsconfig?: TsconfigChoice;
}

### ProjectScan
interface ProjectScan {
    readonly tsconfig: string;
    readonly files: readonly ProjectAnalysis[];
    readonly truncated: boolean;
}

### ScanOptions
interface ScanOptions extends ExtractOptions {
    readonly signal?: AbortSignal;
    readonly maxFiles?: number;
}

### SourceText
interface SourceText {
    readonly fileName: string;
    readonly source: string;
}

### analyzeFiles
function analyzeFiles(texts: readonly SourceText[], { tsconfig, ...options }?: ProjectOptions): ProjectAnalysis[];

### analyzeProject
function analyzeProject(source: string, fileName: string, options?: ProjectOptions): ProjectAnalysis;

### analyzeProjectFiles
function analyzeProjectFiles(tsconfig: string, { signal, maxFiles, ...options }?: ScanOptions): Promise<ProjectScan>;
