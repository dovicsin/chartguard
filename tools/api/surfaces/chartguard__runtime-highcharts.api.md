## @chartguard/runtime-highcharts

### AddSeriesSettings
interface AddSeriesSettings {
    readonly redraw?: boolean;
    readonly animation?: unknown;
}

### Added
interface Added<S> {
    readonly series: S | undefined;
    readonly result: ValidationResult;
}

### ChartEvent
interface ChartEvent {
    readonly phase: 'create' | 'update' | 'addSeries';
}

### ChartFactory
type ChartFactory = 'chart' | 'stockChart' | 'mapChart' | 'ganttChart';

### ChartGuard
interface ChartGuard {
    readonly validator?: ConfigValidator;
    readonly options?: ValidationOptions;
    readonly onResult?: (result: ValidationResult, event: ChartEvent) => void;
    readonly block?: boolean;
}

### CreateGuard
interface CreateGuard extends ChartGuard {
    readonly factory?: ChartFactory;
}

### Created
interface Created<C extends object> {
    readonly chart: C | undefined;
    readonly result: ValidationResult;
}

### HighchartsChart
interface HighchartsChart {
    readonly series: readonly HighchartsSeries[];
    readonly options?: unknown;
    get(id: unknown): unknown;
    update(options: unknown, redraw?: boolean, oneToOne?: boolean, animation?: unknown): void;
    addSeries(options: unknown, redraw?: boolean, animation?: unknown): unknown;
}

### HighchartsNamespace
interface HighchartsNamespace<C extends object> {
    readonly version?: unknown;
    chart?(container: unknown, options: unknown): C;
    stockChart?(container: unknown, options: unknown): C;
    mapChart?(container: unknown, options: unknown): C;
    ganttChart?(container: unknown, options: unknown): C;
}

### HighchartsSeries
interface HighchartsSeries {
    readonly type?: unknown;
    readonly coll?: unknown;
    readonly userOptions?: unknown;
    readonly options?: unknown;
}

### UpdateSettings
interface UpdateSettings {
    readonly redraw?: boolean;
    readonly oneToOne?: boolean;
    readonly animation?: unknown;
}

### addSeries
function addSeries<C extends HighchartsChart>(chart: C, options: unknown, settings?: AddSeriesSettings, guard?: ChartGuard): Added<ReturnType<C['addSeries']>>;

### checkUpdate
function checkUpdate(chart: HighchartsChart, options: unknown, settings?: UpdateSettings, guard?: ChartGuard): ValidationResult;

### createChart
function createChart<C extends object>(highcharts: HighchartsNamespace<C>, container: unknown, options: unknown, guard?: CreateGuard): Created<C>;

### update
function update(chart: HighchartsChart, options: unknown, settings?: UpdateSettings, guard?: ChartGuard): ValidationResult;

### validateBeforeCreate
validateBeforeCreate: import("@chartguard/core").ValidateBeforeCreate
