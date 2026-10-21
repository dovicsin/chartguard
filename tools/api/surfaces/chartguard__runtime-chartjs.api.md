## @chartguard/runtime-chartjs

### GuardEvent
interface GuardEvent {
    readonly phase: 'create' | 'update';
    readonly mode?: string;
}

### GuardOptions
interface GuardOptions {
    readonly validator?: ConfigValidator;
    readonly options?: ValidationOptions;
    readonly onResult?: (result: ValidationResult, event: GuardEvent) => void;
    readonly block?: boolean;
    readonly updates?: boolean;
}

### GuardPlugin
interface GuardPlugin {
    readonly id: 'chartguard';
    beforeInit(chart: GuardedChart): void;
    beforeUpdate(chart: GuardedChart, args: {
        readonly mode?: string;
    }): boolean | undefined;
}

### guard
function guard<T extends object>(config: T, options?: GuardOptions): T;

### registriesOf
function registriesOf(chart: {
    readonly registry?: unknown;
}, plugins?: unknown): Readonly<Record<string, RegistryContext>>;

### validateBeforeCreate
validateBeforeCreate: import("@chartguard/core").ValidateBeforeCreate
