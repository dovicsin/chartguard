/**
 * Every demo of the local Highcharts corpus (the official demos at v13.1.1, imported into the local
 * cache; never committed, license) that is not clean, grouped by why. Generated from a headless
 * Chrome run, then reviewed; the conformance test fails when a demo changes group or becomes clean.
 * Only demo names and explanations are recorded here, no Highcharts content.
 */
export const EXPECTATIONS = [
	{
		why: "Environment: the demo loads its data over the network (`fetch`, the data module), which the offline browser blocks.",
		paths: [
			"arearange/demo.js",
			"bar-race/demo.js",
			"donut-race/demo.js",
			"dynamic-master-detail/demo.js",
			"heatmap-canvas/demo.js",
			"line-csv/demo.js",
			"line-forecast/demo.js",
			"line-time-series/demo.js",
			"live-data/demo.js",
			"parallel-coordinates/demo.js",
			"synchronized-charts/demo.js",
			"treemap-large-dataset/demo.js"
		]
	},
	{
		why: "Environment: the demo page loads a script from outside the pinned highcharts package (a data connector, math.js, another product bundle).",
		paths: [
			"annotations/demo.js",
			"combo-regression/demo.js",
			"combo-timeline/demo.js"
		]
	},
	{
		why: "Environment: the demo creates its chart only after downloading data, which the offline browser blocks.",
		paths: [
			"combo-meteogram/demo.js"
		]
	},
	{
		why: "Out of scope: Highcharts warns that the page does not load the accessibility module; a page setup, not an option.",
		paths: [
			"heatmap-interpolation/demo.js",
			"streamgraph/demo.js"
		]
	},
	{
		why: "False negative (CG-02-08): in styled mode (`chart.styledMode`) Highcharts warns about presentational options (#35); a cross-property rule.",
		paths: [
			"styled-mode-column/demo.js",
			"styled-mode-pie/demo.js"
		]
	},
	{
		why: "Type contract: a value outside the declared type that the runtime renders silently, coerces or ignores (an axis title `\"\"`, label text `0`, `halo: 0`, `useHTML: \"true\"`, `verticalAlign: \"center\"`, `overflow: \"none\"`, a percentage `marker.width`).",
		paths: [
			"bar-force/demo.js",
			"livedata-columns/demo.js",
			"line-race/demo.js",
			"polar-advanced/demo.js",
			"stellar-chart/demo.js",
			"treegraph-boxes/demo.js",
			"treegraph-chart/demo.js"
		]
	},
	{
		why: "Unresolved: user data the runtime keeps but the declarations do not list (`custom`, `website`, `region`, `hc-a2`, `date`, `dial`, `longDescription`, a top-level `countries`, annotation label `id`, `chart.skipClone`).",
		paths: [
			"accessible-line/demo.js",
			"accessible-pie/demo.js",
			"area-race-chart/demo.js",
			"gauge-clock/demo.js",
			"honeycomb-usa/demo.js",
			"neural-network/demo.js",
			"sparkline/demo.js",
			"venn-diagram/demo.js"
		]
	},
	{
		why: "Unresolved: an option the declarations of that series or component do not list, which the runtime renders without complaint (`colorByPoint` and `colors` on pie, venn and level options, `levels[].height`, `nodeFormat`, `fillOpacity`, `crosshair.enabled`, 3D `depth`, `paths`, …).",
		paths: [
			"3d-area-multiple/demo.js",
			"3d-scatter-draggable/demo.js",
			"audio-boxplot/demo.js",
			"calendar-heatmap-month/demo.js",
			"chord-diagram/demo.js",
			"column-comparison/demo.js",
			"combo-data-resolution/demo.js",
			"donut-chart/demo.js",
			"euler-diagram/demo.js",
			"horizontal-organization-chart/demo.js",
			"line-custom-entrance-animation/demo.js",
			"organization-chart/demo.js",
			"packed-bubble-project-status/demo.js",
			"parallel-coordinates-polar/demo.js",
			"pictorial-stackshadow/demo.js",
			"pictorial/demo.js",
			"pie-custom-entrance-animation/demo.js",
			"pie-drilldown/demo.js",
			"pie-legend/demo.js",
			"plotline-context/demo.js",
			"sankey-diagram/demo.js",
			"sonification-music/demo.js",
			"treegraph-inverted/demo.js",
			"treemap-with-levels/demo.js"
		]
	},
	{
		why: "Unresolved: `flame` is a series type the declarations do not type; the module registers it.",
		paths: [
			"flame/demo.js"
		]
	}
];
