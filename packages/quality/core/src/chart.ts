import type { Fact, Listed } from './facts.js';

/** What a series draws, across libraries; `other` keeps the library type for rules that need it. */
export type SeriesKind = 'bar' | 'line' | 'area' | 'scatter' | 'pie' | 'other';

/** The direction a series' values grow in: up (`vertical`, the values on the y axis) or across (`horizontal`). */
export type Orientation = 'vertical' | 'horizontal';

/** Whether a series' values are stacked onto the series sharing its stack, as amounts or as shares (`percent`). */
export type Stacking = 'none' | 'stacked' | 'percent';

/** The coordinate system a series is drawn in. */
export type CoordinateSystem = 'cartesian' | 'polar';

/** A value of a series and where it is in the config. */
export interface ValueAt {
	readonly value: number;
	readonly path: string;
}

/**
 * The numeric values a series draws: how many, the smallest and the largest. The payload of a
 * `Fact`: known only when every element of the data could be read (gaps, `null`, are skipped).
 */
export interface ValueSummary {
	readonly count: number;
	readonly min: ValueAt | undefined;
	readonly max: ValueAt | undefined;
}

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
	/**
	 * The colour the series is drawn in, as the runtime sets it: a CSS colour (Highcharts palette colours
	 * are CSS variables). Per-point colours and gradients are `unmodelled`.
	 */
	readonly color: Fact<string>;
	/** Its values as the runtime reads them from `data`; `unmodelled` for shapes not read yet (datasets, parsing keys, ranges). */
	readonly values: Fact<ValueSummary>;
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
	readonly title: TitleSemantics;
}

/** A title (of the chart or an axis): its text and whether it is shown. */
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
