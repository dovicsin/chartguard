/**
 * Every example in corpus/echarts.json that is not clean (rendered silently with no warning
 * or error from the validator), grouped by why. Generated from a sandbox run, then reviewed; the
 * conformance test fails when an example changes group or a listed example becomes clean.
 */
export const EXPECTATIONS = [
	{
		why: "Environment: the example loads its data asynchronously (`$.get`, `fetch`) and sets `option` in a callback the sandbox never runs.",
		paths: [
			"bar-race-country.ts",
			"candlestick-brush.ts",
			"confidence-band.ts",
			"custom-ohlc.ts",
			"custom-wind.ts",
			"data-transform-filter.ts",
			"dataset-encode1.ts",
			"dataset-link.ts",
			"flame-graph.ts",
			"geo-beef-cuts.ts",
			"geo-choropleth-scatter.ts",
			"geo-graph.ts",
			"geo-seatmap-flight.ts",
			"geo-svg-custom-effect.ts",
			"geo-svg-lines.ts",
			"geo-svg-map.ts",
			"geo-svg-scatter-simple.ts",
			"geo-svg-traffic.ts",
			"graph-circular-layout.ts",
			"graph-force.ts",
			"graph-label-overlap.ts",
			"graph-life-expectancy.ts",
			"graph-npm.ts",
			"graph-webkit-dep.ts",
			"graph.ts",
			"line-aqi.ts",
			"line-race.ts",
			"lines-airline.ts",
			"lines-bmap-bus.ts",
			"lines-bmap-effect.ts",
			"lines-bmap.ts",
			"map-HK.ts",
			"map-bar-morph.ts",
			"map-iceland-pie.ts",
			"map-usa-projection.ts",
			"map-usa.ts",
			"matrix-mini-bar-geo.ts",
			"mix-zoom-on-value.ts",
			"parallel-nutrients.ts",
			"sankey-energy.ts",
			"sankey-levels.ts",
			"sankey-nodeAlign-left.ts",
			"sankey-nodeAlign-right.ts",
			"scatter-nutrients-matrix.ts",
			"scatter-nutrients.ts",
			"scatter-painter-choice.ts",
			"scatter-stream-visual.ts",
			"scatter-weibo.ts",
			"tree-basic.ts",
			"tree-orient-bottom-top.ts",
			"tree-orient-right-left.ts",
			"tree-radial.ts",
			"tree-vertical.ts",
			"treemap-disk.ts",
			"treemap-drill-down.ts",
			"treemap-obama.ts",
			"treemap-show-parent.ts",
			"treemap-sunburst-transition.ts",
			"treemap-visual.ts",
			"wind-barb.ts"
		]
	},
	{
		why: "Environment: the example needs the ecStat extension, which the sandbox does not install.",
		paths: [
			"bar-histogram.ts",
			"scatter-clustering.ts",
			"scatter-exponential-regression.ts",
			"scatter-linear-regression.ts",
			"scatter-logarithmic-regression.ts",
			"scatter-polynomial-regression.ts"
		]
	},
	{
		why: "Environment: the example uses browser APIs (`window`, `document`, `Image`, `XMLHttpRequest`); the sandbox has no DOM.",
		paths: [
			"line-draggable.ts",
			"lines-ny.ts",
			"matrix-confusion.ts",
			"matrix-covariance.ts",
			"matrix-mbti.ts",
			"pie-pattern.ts",
			"scatter-nebula.ts",
			"watermark.ts"
		]
	},
	{
		why: "Environment: the map must be registered with `echarts.registerMap` from GeoJSON the example downloads.",
		paths: [
			"effectScatter-map.ts",
			"scatter-map-brush.ts"
		]
	},
	{
		why: "Unresolved: more than 20 000 data entries; the inspection limit is reached and the rest is not checked.",
		paths: [
			"bar-large.ts",
			"candlestick-large.ts",
			"heatmap-large-piecewise.ts",
			"heatmap-large.ts",
			"scatter-large.ts"
		]
	},
	{
		why: "Unresolved: sparse data arrays; holes are reported as not evaluated.",
		paths: [
			"matrix-stock.ts",
			"scatter-matrix.ts"
		]
	},
	{
		why: "Unresolved: options not declared in 6.1.0 (`sankey.layout`, `show` or layout keys on an inside dataZoom, label `textStyle` and `formatter` nesting from ECharts 3); the runtime ignores them or warns that they are deprecated.",
		paths: [
			"candlestick-touch.ts",
			"line-function.ts",
			"matrix-periodic-table.ts",
			"sankey-simple.ts"
		]
	},
	{
		why: "False negative (CG-02-08): `legend.data` names a series that does not exist; the runtime warns, the validator does not compare the two yet.",
		paths: [
			"candlestick-sh-2015.ts",
			"custom-cartesian-polygon.ts",
			"custom-error-scatter.ts",
			"line-graphic.ts",
			"line-tooltip-touch.ts",
			"pie-roseType.ts"
		]
	},
	{
		why: "False negative (CG-02-06): a deprecated option (`label.margin`, `radar.indicator.text`); the runtime warns, deprecations are not modelled yet.",
		paths: [
			"pie-alignTo.ts",
			"radar-custom.ts"
		]
	},
	{
		why: "Out of scope: the deprecation is a call inside a `renderItem` callback (`api.style`), which static validation never runs.",
		paths: [
			"custom-bar-trend.ts"
		]
	}
];
