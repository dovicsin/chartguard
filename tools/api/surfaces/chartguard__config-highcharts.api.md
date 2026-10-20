## @chartguard/config-highcharts

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

### createValidator
function createValidator(artifact: unknown, { extensions }?: {
    readonly extensions?: readonly Extension[];
}): ConfigValidator;

### manifest
manifest: SchemaManifest

### validate
function validate(input: unknown, options?: ValidationOptions): ValidationResult;
