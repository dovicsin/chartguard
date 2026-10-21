## @chartguard/runtime-echarts

### EChartsInstance
interface EChartsInstance {
    setOption(option: unknown, settings?: unknown): void;
    getOption(): unknown;
}

### SetOptionGuard
interface SetOptionGuard {
    readonly validator?: ConfigValidator;
    readonly options?: ValidationOptions;
    readonly onResult?: (result: ValidationResult, event: {
        readonly fresh: boolean;
    }) => void;
    readonly block?: boolean;
}

### SetOptionSettings
type SetOptionSettings = boolean | {
    readonly notMerge?: boolean;
    readonly replaceMerge?: string | readonly string[];
    readonly lazyUpdate?: boolean;
    readonly silent?: boolean;
};

### checkOption
function checkOption(chart: EChartsInstance, option: unknown, settings?: SetOptionSettings, guard?: SetOptionGuard): ValidationResult;

### setOption
function setOption(chart: EChartsInstance, option: unknown, settings?: SetOptionSettings, guard?: SetOptionGuard): ValidationResult;

### validateBeforeCreate
validateBeforeCreate: import("@chartguard/core").ValidateBeforeCreate
