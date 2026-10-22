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
}

### CoordinateSystem
type CoordinateSystem = 'cartesian' | 'polar';

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
    readonly source: 'config';
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

### Orientation
type Orientation = 'vertical' | 'horizontal';

### PathSegment
type PathSegment = string | number;

### RULE_CATALOG
RULE_CATALOG: readonly RuleInfo[]

### RuleInfo
interface RuleInfo {
    readonly id: string;
    readonly code: string;
    readonly severity: 'warning' | 'info';
    readonly title: string;
    readonly rationale: string;
    readonly evidence: readonly Evidence[];
    readonly limits: readonly string[];
}

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
type UnknownReason = 'unset' | 'accessor' | 'dynamic' | 'shape' | 'unmodelled' | 'inapplicable';

### ValueAt
interface ValueAt {
    readonly value: number;
    readonly path: string;
}

### ValueSummary
interface ValueSummary {
    readonly count: number;
    readonly min: ValueAt | undefined;
    readonly max: ValueAt | undefined;
}

### colorKey
function colorKey(color: string): string;

### contrastRatio
function contrastRatio(foreground: string, background: string): number | undefined;

### defaulted
defaulted: <T>({ value, pointer }: Default<T>, path: string) => KnownFact<T>

### firstSet
function firstSet<T>(scopes: readonly Fact<T>[], fallback?: Default<T>): Fact<T>;

### formatPath
function formatPath(path: readonly PathSegment[]): string;

### isBoolean
isBoolean: (value: unknown) => value is boolean

### isNumber
isNumber: (value: unknown) => value is number

### isString
isString: (value: unknown) => value is string

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
function review(chart: ChartSemantics): QualityReport;

### sameShades
function sameShades(color: Fact<string>): Fact<Shades>;

### unknown
unknown: (path: string, reason: UnknownReason) => UnknownFact

### valueOf
valueOf: <T>(fact: Fact<T>) => T | undefined

### valuesAt
function valuesAt(root: unknown, path: readonly PathSegment[], read: ElementReader): Fact<ValueSummary>;
