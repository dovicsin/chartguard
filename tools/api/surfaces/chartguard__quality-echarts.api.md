## @chartguard/quality-echarts

### QualityOptions
interface QualityOptions {
    readonly rules?: Readonly<Record<string, RuleLevel | RuleSetting>>;
    readonly context?: QualityContext;
}

### QualityOptionsError
class QualityOptionsError extends TypeError {
    readonly name = "QualityOptionsError";
    readonly problems: readonly string[];
    constructor(problems: readonly string[]);
}

### analyze
function analyze(config: unknown, options?: QualityOptions): QualityReport;

### assertQualityOptions
function assertQualityOptions(value: unknown): asserts value is QualityOptions;

### normalize
function normalize(config: unknown): ChartSemantics;
