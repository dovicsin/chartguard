## @chartguard/quality-core

### Fact
interface Fact<T> {
    readonly value: T;
    readonly path: string;
}

### NormalizedChart
interface NormalizedChart {
    readonly kind?: Fact<string> | undefined;
    readonly yMin?: Fact<number> | undefined;
    readonly title?: Fact<string> | undefined;
}

### PathSegment
type PathSegment = string | number;

### formatPath
function formatPath(path: readonly PathSegment[]): string;

### numberAt
function numberAt(root: unknown, path: readonly PathSegment[]): Fact<number> | undefined;

### readPath
function readPath(root: unknown, path: readonly PathSegment[]): unknown;

### review
function review(chart: NormalizedChart, library: string): QualityReport;

### stringAt
function stringAt(root: unknown, path: readonly PathSegment[]): Fact<string> | undefined;
