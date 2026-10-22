## @chartguard/quality-core

### AxisSemantics
interface AxisSemantics {
    readonly key: string;
    readonly path: string;
    readonly min: Fact<number>;
    readonly max: Fact<number>;
    readonly title: Fact<string>;
}

### ChartSemantics
interface ChartSemantics {
    readonly library: string;
    readonly title: TitleSemantics;
    readonly series: Listed<SeriesSemantics>;
    readonly axes: readonly AxisSemantics[];
}

### CoordinateSystem
type CoordinateSystem = 'cartesian' | 'polar';

### Default
interface Default<T> {
    readonly value: T;
    readonly pointer: string;
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

### readFact
function readFact<T>(root: unknown, path: readonly PathSegment[], is: (value: unknown) => value is T, fallback?: Default<T>): Fact<T>;

### readPath
function readPath(root: unknown, path: readonly PathSegment[]): unknown;

### review
function review(chart: ChartSemantics): QualityReport;

### unknown
unknown: (path: string, reason: UnknownReason) => UnknownFact

### valueOf
valueOf: <T>(fact: Fact<T>) => T | undefined
