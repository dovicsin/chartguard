import type { Fact, KnownFact, Listed } from './facts.js';

/** What a series draws, across libraries; `other` keeps the library type for rules that need it. */
export type SeriesKind = 'bar' | 'line' | 'area' | 'scatter' | 'pie' | 'other';

/** The direction a series' values grow in: up (`vertical`, the values on the y axis) or across (`horizontal`). */
export type Orientation = 'vertical' | 'horizontal';

/** Whether a series' values are stacked onto the series sharing its stack, as amounts or as shares (`percent`). */
export type Stacking = 'none' | 'stacked' | 'percent';

/** The coordinate system a series is drawn in. */
export type CoordinateSystem = 'cartesian' | 'polar';

/**
 * A colour as it is shown in each colour scheme the chart can be shown in: `light`, `dark`, or both
 * (the same colour in both when it does not depend on the scheme). The payload of a `Fact`; each shade
 * carries where it was read from, or the runtime default it comes from.
 */
export interface Shades {
	readonly light: KnownFact<string> | undefined;
	readonly dark: KnownFact<string> | undefined;
}

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
	 * The value a bar grows from (Chart.js `base`, ECharts `startValue` of its value axis, Highcharts
	 * `threshold`); zero by default. `inapplicable` for series that are not bars.
	 */
	readonly base: Fact<number>;
	/**
	 * The colour the series is drawn in, as the runtime sets it: a CSS colour (Highcharts palette colours
	 * are CSS variables). Per-point colours and gradients are `unmodelled`.
	 */
	readonly color: Fact<string>;
	/** Its colour as shown in each colour scheme: CSS variables resolved, for contrast. */
	readonly shades: Fact<Shades>;
	/** Its values as the runtime reads them from `data`; `unmodelled` for shapes not read yet (datasets, parsing keys, ranges). */
	readonly values: Fact<ValueSummary>;
}

/**
 * Where a range the runtime fits to the data puts zero: `excluded` at every size the chart can be
 * drawn at, or `included` at every size.
 */
export type ZeroFit = 'excluded' | 'included';

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
	/**
	 * Whether the range the runtime fits to the data leaves zero out, when the config asks for a range
	 * fitted to the data (Chart.js `beginAtZero: false`, ECharts `scale: true`) and sets no bound: the
	 * path is that switch. `unset` when the config does not ask; `layout` when it depends on the size.
	 */
	readonly fit: Fact<ZeroFit>;
	/**
	 * The unit the tick labels show around each value (`%` from a format `{value}%`); empty when they
	 * show bare numbers. A function that formats them is `dynamic`.
	 */
	readonly unit: Fact<string>;
	/** Values grow towards the origin of the screen direction (down, or left). */
	readonly reversed: Fact<boolean>;
	readonly title: TitleSemantics;
}

/** A title (of the chart or an axis): its text and whether it is shown. */
export interface TitleSemantics {
	readonly text: Fact<string>;
	readonly shown: Fact<boolean>;
}

/** What assistive technology gets from the chart (CG-05-04 part 5). */
export interface AccessSemantics {
	/** Whether the data is described to assistive technology: point labels, or a generated description. */
	readonly dataDescribed: Fact<boolean>;
	/** Whether the chart can be operated with a keyboard. */
	readonly keyboard: Fact<boolean>;
}

/** The motion a chart starts by itself when it is drawn (CG-05-04 part 7). */
export interface MotionSemantics {
	/** Whether something keeps moving without end (a looping animation, a ripple effect). */
	readonly endless: Fact<boolean>;
	/** The longest animation that runs when the chart is drawn, in milliseconds (0 when none). */
	readonly longest: Fact<number>;
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
	readonly access: AccessSemantics;
	/** The background the series are drawn on, in each colour scheme; unknown when the page shows through. */
	readonly background: Fact<Shades>;
	readonly motion: MotionSemantics;
}
