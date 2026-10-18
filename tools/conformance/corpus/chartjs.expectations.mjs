/**
 * Every example in corpus/chartjs.json that is not clean (rendered silently with no warning
 * or error from the validator), grouped by why. Generated from a sandbox run, then reviewed; the
 * conformance test fails when an example changes group or a listed example becomes clean.
 */
export const EXPECTATIONS = [
	{
		why: "Unresolved: element options (`radius`, `fill`, `hoverRadius`, …) set at the options root or on a dataset, and per-property `animation` keys, reach the runtime through its resolver scope chain, which the declarations do not describe (CG-02-04).",
		paths: [
			"advanced/data-decimation.md",
			"animations/loop.md",
			"animations/progressive-line-easing.md",
			"animations/progressive-line.md",
			"area/line-drawtime.md",
			"line/multi-axis.md",
			"line/segments.md"
		]
	},
	{
		why: "Unresolved: the sample registers its own scale or controller in a separate file the docs load next to it; the bare runtime does not know the type.",
		paths: [
			"advanced/derived-axis-type.md",
			"advanced/derived-chart-type.md"
		]
	},
	{
		why: "Environment: the sample builds HTML with `document`; the conformance sandbox has no DOM.",
		paths: [
			"advanced/progress-bar.md",
			"legend/html.md"
		]
	}
];
