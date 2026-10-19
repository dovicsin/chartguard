import { runtimePointer, runtimeSection } from './runtime.mjs';

/**
 * A root option of a built-in component is handled only when that component is registered:
 * `checkMissingComponents` (lib/model/Global.js) logs an error for every root key listed in
 * `BUITIN_COMPONENTS_MAP` whose component class is missing (`ComponentModel.hasClass(mainType)`).
 * The list is read from the pinned runtime, commented-out entries excluded, so it cannot go stale.
 */
const COMPONENTS = { file: 'lib/model/Global.js', pattern: 'var BUITIN_COMPONENTS_MAP = {', end: '};' };
const CHECK = { file: 'lib/model/Global.js', pattern: 'error("Component " + mainType + " is used but not imported.' };
const ENTRY = /^\s*(\w+): '\w+',?$/;

function componentKeys(root) {
	const { pointer, lines } = runtimeSection(root, 'echarts', COMPONENTS);
	const keys = lines.flatMap((line) => ENTRY.exec(line)?.[1] ?? []);
	if (keys.length === 0) throw new Error(`echarts runtime changed: no component keys at ${pointer}`);
	return { keys, pointer };
}

/** Marks, in place, every root option of `EChartsOption` that names a built-in component with its handler. */
export function addComponentHandlers(root, option) {
	const { keys, pointer } = componentKeys(root);
	const cited = [pointer, runtimePointer(root, 'echarts', CHECK)].map((at) => ({ source: 'echarts', pointer: at }));
	const handled = keys.filter((key) => Object.hasOwn(option.properties, key));
	for (const key of handled) {
		const property = option.properties[key];
		property.handledBy = { id: 'echarts', name: key, enforced: true };
		property.provenance = { ...property.provenance, sources: [...property.provenance.sources, ...cited] };
	}
	return handled;
}
