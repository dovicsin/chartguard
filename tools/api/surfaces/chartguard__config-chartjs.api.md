## @chartguard/config-chartjs

### ChartjsExtension
interface ChartjsExtension extends Extension {
    readonly controllers?: Readonly<Record<string, ControllerExtension>>;
}

### ControllerExtension
interface ControllerExtension {
    readonly extends: string;
    readonly dataset?: NodeSchema;
    readonly options?: NodeSchema;
}

### Extension
interface Extension {
    readonly id: string;
    readonly options?: Readonly<Record<string, Readonly<Record<string, NodeSchema>>>>;
    readonly variants?: Readonly<Record<string, Readonly<Record<string, VariantSpec>>>>;
}

### ExtensionError
class ExtensionError extends Error {
    readonly problems: readonly string[];
    readonly name = "ExtensionError";
    constructor(problems: readonly string[]);
}

### schema
function schema(): LoweredSchema;

### validate
function validate(input: unknown, options?: ValidationOptions): ValidationResult;

### withExtensions
function withExtensions(extensions: readonly ChartjsExtension[]): ConfigValidator;
