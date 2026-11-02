/**
 * Every example in corpus/chartjs.json that is not clean (rendered silently with no warning
 * or error from the validator), grouped by why. Generated from a sandbox run, then reviewed; the
 * conformance test fails when an example changes group or a listed example becomes clean.
 */
export const EXPECTATIONS = [
	{
		why: 'Unresolved: `stacked` at the options root is a scale option the runtime ignores there.',
		paths: ['line/multi-axis.md']
	},
	{
		why: 'Unresolved: a scale title is padded only by `top` and `bottom` (`drawTitle` reads `padding.top`/`padding.bottom`, `getTitleHeight` `padding.height`); `left` and `right`, which `toPadding` also reads, have no effect there. Checked since the runtime-chosen type of a scale without `type` is modelled (`mergeScaleConfig`).',
		paths: ['scale-options/titles.md']
	},
	{
		why: 'Unresolved: the sample registers its own scale or controller in a separate file the docs load next to it; the bare runtime does not know the type.',
		paths: ['advanced/derived-axis-type.md', 'advanced/derived-chart-type.md']
	},
	{
		why: 'Environment: the sample builds HTML with `document`; the conformance sandbox has no DOM.',
		paths: ['advanced/progress-bar.md', 'legend/html.md']
	}
];
