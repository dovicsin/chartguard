## @chartguard/quality-core

### AccessSemantics
interface AccessSemantics {
    readonly dataDescribed: Fact<boolean>;
    readonly keyboard: Fact<boolean>;
}

### AxisSemantics
interface AxisSemantics {
    readonly key: string;
    readonly path: string;
    readonly scale: Fact<ScaleType>;
    readonly min: Fact<number | 'data'>;
    readonly max: Fact<number | 'data'>;
    readonly fit: Fact<ZeroFit>;
    readonly unit: Fact<string>;
    readonly reversed: Fact<boolean>;
    readonly title: TitleSemantics;
}

### ChartSemantics
interface ChartSemantics {
    readonly library: string;
    readonly title: TitleSemantics;
    readonly series: Listed<SeriesSemantics>;
    readonly axes: readonly AxisSemantics[];
    readonly access: AccessSemantics;
    readonly background: Fact<Shades>;
    readonly motion: MotionSemantics;
}

### ContextCondition
interface ContextCondition {
    readonly fact: ContextFact;
    readonly effect: 'supplies' | 'satisfies';
    readonly note: string;
}

### ContextFact
type ContextFact = 'background' | 'describesData' | 'pausesMotion';

### CoordinateSystem
type CoordinateSystem = 'cartesian' | 'polar';

### Current
type Current = {
    readonly set: false;
} | {
    readonly set: true;
    readonly value: OptionValue;
};

### Default
interface Default<T> {
    readonly value: T;
    readonly pointer: string;
}

### ElementReader
type ElementReader = (element: unknown, path: readonly PathSegment[]) => ValueAt | null | UnknownFact;

### Evidence
interface Evidence {
    readonly authors: string;
    readonly title: string;
    readonly venue: string;
    readonly year: number;
}

### Fact
type Fact<T> = KnownFact<T> | UnknownFact;

### FixPolicy
type FixPolicy = {
    readonly offered: true;
    readonly edit: string;
} | {
    readonly offered: false;
    readonly why: string;
};

### Ignore
interface Ignore {
    readonly path: string;
    readonly reason: string;
}

### Impact
type Impact = 'misleads' | 'excludes' | 'omits' | 'risks';

### Item
interface Item {
    readonly value: unknown;
    readonly segments: readonly PathSegment[];
    readonly path: string;
}

### KnownFact
type KnownFact<T> = {
    readonly known: true;
    readonly value: T;
    readonly path: string;
    readonly source: 'config' | 'context';
} | {
    readonly known: true;
    readonly value: T;
    readonly path: string;
    readonly source: 'default';
    readonly pointer: string;
};

### Listed
type Listed<T> = {
    readonly known: true;
    readonly path: string;
    readonly items: readonly T[];
} | UnknownFact;

### MotionSemantics
interface MotionSemantics {
    readonly endless: Fact<boolean>;
    readonly longest: Fact<number>;
}

### Orientation
type Orientation = 'vertical' | 'horizontal';

### PageBackground
type PageBackground = string | {
    readonly light?: string;
    readonly dark?: string;
};

### PathSegment
type PathSegment = string | number;

### QualityContext
interface QualityContext {
    readonly background?: PageBackground;
    readonly describesData?: boolean;
    readonly pausesMotion?: boolean;
}

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

### RULE_CATALOG
RULE_CATALOG: readonly RuleInfo[]

### Remedies
type Remedies = Readonly<Record<string, (now: Current, path: string, config: unknown) => Remedy | undefined>>;

### Remedy
interface Remedy {
    readonly value: OptionValue;
    readonly effect: string;
}

### RuleInfo
interface RuleInfo {
    readonly id: string;
    readonly code: string;
    readonly severity: 'warning' | 'info';
    readonly impact: Impact;
    readonly context: readonly ContextCondition[];
    readonly fix: FixPolicy;
    readonly title: string;
    readonly rationale: string;
    readonly evidence: readonly Evidence[];
    readonly limits: readonly string[];
}

### RuleLevel
type RuleLevel = 'off' | 'info' | 'warning';

### RuleSetting
interface RuleSetting {
    readonly level?: RuleLevel;
    readonly ignore?: readonly Ignore[];
}

### SEVERITY_OF_IMPACT
SEVERITY_OF_IMPACT: Readonly<Record<Impact, 'warning' | 'info'>>

### ScaleType
type ScaleType = 'linear' | 'log' | 'category' | 'time' | 'other';

### SeriesKind
type SeriesKind = 'bar' | 'line' | 'area' | 'scatter' | 'pie' | 'other';

### SeriesSemantics
interface SeriesSemantics {
    readonly path: string;
    readonly type: Fact<string>;
    readonly kind: Fact<SeriesKind>;
    readonly name: Fact<string>;
    readonly valueAxis: Fact<string>;
    readonly coordinateSystem: Fact<CoordinateSystem>;
    readonly orientation: Fact<Orientation>;
    readonly stacking: Fact<Stacking>;
    readonly base: Fact<number>;
    readonly color: Fact<string>;
    readonly shades: Fact<Shades>;
    readonly values: Fact<ValueSummary>;
}

### Shades
interface Shades {
    readonly light: KnownFact<string> | undefined;
    readonly dark: KnownFact<string> | undefined;
}

### Stacking
type Stacking = 'none' | 'stacked' | 'percent';

### TitleSemantics
interface TitleSemantics {
    readonly text: Fact<string>;
    readonly shown: Fact<boolean>;
}

### UnknownFact
interface UnknownFact {
    readonly known: false;
    readonly path: string;
    readonly reason: UnknownReason;
}

### UnknownReason
type UnknownReason = 'unset' | 'accessor' | 'dynamic' | 'shape' | 'unmodelled' | 'inapplicable' | 'layout' | 'page';

### ValueAt
interface ValueAt {
    readonly value: number;
    readonly path: string;
}

### ValueRange
type ValueRange = readonly [
    number,
    number
];

### ValueSummary
interface ValueSummary {
    readonly count: number;
    readonly min: ValueAt | undefined;
    readonly max: ValueAt | undefined;
}

### ZeroFit
type ZeroFit = 'excluded' | 'included';

### assertQualityOptions
function assertQualityOptions(value: unknown): asserts value is QualityOptions;

### colorKey
function colorKey(color: string): string;

### contrastRatio
function contrastRatio(foreground: string, background: string): number | undefined;

### currentAt
function currentAt(config: unknown, path: string): Current | undefined;

### dataRange
function dataRange(series: Listed<SeriesSemantics>, key: string, at: string): Fact<ValueRange>;

### defaulted
defaulted: <T>({ value, pointer }: Default<T>, path: string) => KnownFact<T>

### firstSet
function firstSet<T>(scopes: readonly Fact<T>[], fallback?: Default<T>): Fact<T>;

### formatPath
function formatPath(path: readonly PathSegment[]): string;

### holds
function holds(root: unknown, path: readonly PathSegment[]): boolean;

### isBoolean
isBoolean: (value: unknown) => value is boolean

### isNumber
isNumber: (value: unknown) => value is number

### isString
isString: (value: unknown) => value is string

### isTransparent
function isTransparent(color: string): boolean;

### itemsAt
function itemsAt(root: unknown, path: readonly PathSegment[], { single }?: {
    single?: boolean | undefined;
}): Listed<Item>;

### known
known: <T>(value: T, path: string) => KnownFact<T>

### numberElement
function numberElement(element: unknown, path: readonly PathSegment[]): ValueAt | null | undefined;

### numberOr
function numberOr(element: unknown, path: readonly PathSegment[], reason: UnknownFact['reason']): ValueAt | null | UnknownFact;

### readFact
function readFact<T>(root: unknown, path: readonly PathSegment[], is: (value: unknown) => value is T, fallback?: Default<T>): Fact<T>;

### readPath
function readPath(root: unknown, path: readonly PathSegment[]): unknown;

### review
function review(chart: ChartSemantics, options?: QualityOptions): QualityReport;

### sameShades
function sameShades(color: Fact<string>): Fact<Shades>;

### unknown
unknown: (path: string, reason: UnknownReason) => UnknownFact

### valueOf
valueOf: <T>(fact: Fact<T>) => T | undefined

### valuesAt
function valuesAt(root: unknown, path: readonly PathSegment[], read: ElementReader): Fact<ValueSummary>;

### withFixes
function withFixes(report: QualityReport, config: unknown, remedies: Remedies, analyze: (config: unknown) => QualityReport): QualityReport;

### zeroFit
function zeroFit(ranges: readonly ValueRange[], asked: KnownFact<unknown>): Fact<ZeroFit>;
