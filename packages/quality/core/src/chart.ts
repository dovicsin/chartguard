import type { Fact, Listed } from './facts.js';

/** What a series draws, across libraries; `other` keeps the library type for rules that need it. */
export type SeriesKind = 'bar' | 'line' | 'area' | 'scatter' | 'pie' | 'other';

/** The direction a series' values grow in: up (`vertical`, the values on the y axis) or across (`horizontal`). */
export type Orientation = 'vertical' | 'horizontal';

/** Whether a series' values are stacked onto the series sharing its stack, as amounts or as shares (`percent`). */
export type Stacking = 'none' | 'stacked' | 'percent';

/** The coordinate system a series is drawn in. */
export type CoordinateSystem = 'cartesian' | 'polar';

/** One series (dataset): its library type, what it draws, its name and the axis its values are measured on. */
export interface SeriesSemantics {
	/** Where the series is in the config. */
	readonly path: string;
	readonly type: Fact<string>;
	readonly kind: Fact<SeriesKind>;
	readonly name: Fact<string>;
	/** The `key` of the axis in `ChartSemantics.axes` its values are plotted against. */
	readonly valueAxis: Fact<string>;
	readonly coordinateSystem: Fact<CoordinateSystem>;
	/** Cartesian series only; `inapplicable` in polar and axis-less series. */
	readonly orientation: Fact<Orientation>;
	readonly stacking: Fact<Stacking>;
}

/** How an axis maps values to positions. */
export type ScaleType = 'linear' | 'log' | 'category' | 'time' | 'other';

/** One axis: the key series refer to it by, its scale, range, direction and title. */
export interface AxisSemantics {
	/** Library-neutral and unique in the chart: `y`, `y-left` (Chart.js scale ids), `yAxis[0]`. */
	readonly key: string;
	/** Where the axis is configured, or would be. */
	readonly path: string;
	readonly scale: Fact<ScaleType>;
	/** A number, or `data`: the axis starts at the smallest value shown (ECharts `min: 'dataMin'`). */
	readonly min: Fact<number | 'data'>;
	readonly max: Fact<number | 'data'>;
	/** Values grow towards the origin of the screen direction (down, or left). */
	readonly reversed: Fact<boolean>;
	readonly title: Fact<string>;
}

/** The chart's title: its text and whether it is shown. */
export interface TitleSemantics {
	readonly text: Fact<string>;
	readonly shown: Fact<boolean>;
}

/**
 * Library-neutral chart semantics (CG-05-02). Every fact is known, with the path it was read from
 * (or the runtime default and its pointer), or unknown with why: rules claim nothing on an unknown fact.
 */
export interface ChartSemantics {
	readonly library: string;
	readonly title: TitleSemantics;
	readonly series: Listed<SeriesSemantics>;
	readonly axes: readonly AxisSemantics[];
}
