import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ECharts picks a component's subtype at runtime (`registerSubTypeDefaulter`), while the
 * declarations type every variant's `type` as plain `string`. This pass writes the runtime's
 * choice into the IR, each fact citing the line of the pinned package it comes from.
 */

/** Variant definition name → the runtime subtype literal, and the default subtype. */
const COMPONENTS = {
	dataZoom: {
		variants: {
			SliderDataZoomOption: { literal: 'slider', file: 'lib/component/dataZoom/SliderZoomModel.js', pattern: "SliderZoomModel.type = 'dataZoom.slider'" },
			InsideDataZoomOption: { literal: 'inside', file: 'lib/component/dataZoom/InsideZoomModel.js', pattern: "InsideZoomModel.type = 'dataZoom.inside'" }
		},
		default: { literal: 'slider', file: 'lib/component/dataZoom/installCommon.js', pattern: "registerSubTypeDefaulter('dataZoom'" }
	},
	legend: {
		variants: {
			LegendOption: { literal: 'plain', file: 'lib/component/legend/LegendModel.js', pattern: "LegendModel.type = 'legend.plain'" },
			ScrollableLegendOption: { literal: 'scroll', file: 'lib/component/legend/ScrollableLegendModel.js', pattern: "ScrollableLegendModel.type = 'legend.scroll'" }
		},
		default: { literal: 'plain', file: 'lib/component/legend/installLegendPlain.js', pattern: "registerSubTypeDefaulter('legend'" }
	},
	timeline: {
		// The base option and the slider option are identical; `slider` is the only registered subtype.
		variants: {
			TimelineOption: { literal: 'slider', file: 'lib/component/timeline/SliderTimelineModel.js', pattern: "SliderTimelineModel.type = 'timeline.slider'" },
			SliderTimelineOption: { literal: 'slider', file: 'lib/component/timeline/SliderTimelineModel.js', pattern: "SliderTimelineModel.type = 'timeline.slider'" }
		},
		default: { literal: 'slider', file: 'lib/component/timeline/install.js', pattern: "registerSubTypeDefaulter('timeline'" }
	}
};

/** Every axis created by `axisModelCreator` resolves its type with `getAxisType`. */
const AXES = ['xAxis', 'yAxis', 'angleAxis', 'radiusAxis', 'singleAxis', 'parallelAxis'];
const AXIS_TYPE = { file: 'lib/coord/axisModelCreator.js', pattern: "option.type || (option.data ? 'category' : 'value')" };

const changed = (what) => new Error(`echarts runtime changed: ${what}`);

/** `echarts/lib/…:<line>` of the first line containing `pattern` in the pinned package. */
function runtimePointer(root, { file, pattern }) {
	const lines = readFileSync(join(root, 'node_modules', 'echarts', file), 'utf8').split('\n');
	const index = lines.findIndex((line) => line.includes(pattern));
	if (index === -1) throw changed(`"${pattern}" not found in ${file}`);
	return `echarts/${file}:${String(index + 1)}`;
}

const provenance = (root, fact) => ({ confidence: 'authoritative', sources: [{ source: 'echarts', pointer: runtimePointer(root, fact) }] });

/** The union a root property holds, and the union of its array items when it is `T | T[]`. */
function unionsOf(definitions, node) {
	const resolve = (candidate) => (candidate.kind === 'ref' ? definitions[candidate.ref] : candidate);
	const outer = resolve(node);
	if (outer.kind !== 'union') throw changed('expected a union');
	const list = outer.anyOf.map(resolve).find((member) => member.kind === 'array');
	return list === undefined ? [outer] : [outer, resolve(list.items)];
}

const memberName = (member) => (member.kind === 'ref' ? member.ref : undefined);

function subtypeComponent(root, definitions, union, component) {
	const objects = union.anyOf.filter((member) => member.kind === 'ref');
	for (const member of objects) {
		const variant = component.variants[memberName(member)];
		if (variant === undefined) throw changed(`unexpected variant ${String(memberName(member))}`);
		const typed = definitions[member.ref].properties.type;
		typed.node = { kind: 'literal', value: variant.literal };
		typed.provenance = provenance(root, variant);
	}
	const defaultIndex = union.anyOf.findIndex((member) => component.variants[memberName(member)]?.literal === component.default.literal);
	Object.assign(union, { discriminator: 'type', defaultVariant: defaultIndex, extensible: true, provenance: provenance(root, component.default) });
}

function axisDefaults(root, definitions, union) {
	const indexOf = (literal) =>
		union.anyOf.findIndex((member) => member.kind === 'ref' && definitions[member.ref].properties.type?.node.value === literal);
	const [category, value] = [indexOf('category'), indexOf('value')];
	if (category === -1 || value === -1) throw changed('axis variants');
	Object.assign(union, { defaultWhen: [{ truthy: 'data', variant: category }], defaultVariant: value, provenance: provenance(root, AXIS_TYPE) });
}

/** Rewrites, in place, the component and axis unions under the root `EChartsOption` definition. */
export function resolveComponentSubtypes(root, definitions, option) {
	for (const [name, component] of Object.entries(COMPONENTS))
		for (const union of unionsOf(definitions, option.properties[name].node)) subtypeComponent(root, definitions, union, component);
	for (const name of AXES) for (const union of unionsOf(definitions, option.properties[name].node)) axisDefaults(root, definitions, union);
}
