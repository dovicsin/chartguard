/**
 * Chart.js resolves every option through its scriptable resolver (`_descriptors` in
 * helpers.dataset.js defaults to `scriptable: true`; the root descriptor is
 * `_scriptable: (name) => !name.startsWith('on')`), so a function is accepted wherever an option
 * value is, whether or not the declarations say `Scriptable<…>`. The few options a plugin marks
 * non-scriptable (`spacing`, callbacks that are functions anyway) are over-accepted: a false
 * negative, never a false rejection.
 *
 * This pass rewrites the IR reachable from each configuration's `options`: every property whose
 * node does not already accept a function becomes `scriptable`. Union discriminators (`type`)
 * stay literal so variants can still be selected.
 */
export function makeOptionsScriptable(definitions, configRefs) {
	const discriminators = new Set();
	const collect = (node) => {
		if (node === null || typeof node !== 'object') return;
		if (node.kind === 'union' && node.discriminator !== undefined) discriminators.add(node.discriminator);
		for (const child of Object.values(node)) collect(child);
	};
	collect(definitions);

	const resolve = (node) => (node.kind === 'ref' ? definitions[node.ref] : node);
	const acceptsFunction = (node, seen = new Set()) => {
		if (node.kind === 'ref') {
			if (seen.has(node.ref)) return false;
			seen.add(node.ref);
		}
		const target = resolve(node);
		if (['function', 'scriptable', 'unknown'].includes(target.kind)) return true;
		return target.kind === 'union' && target.anyOf.some((member) => acceptsFunction(member, seen));
	};

	/** Nodes below `target`: included definitions, then members, items, values; a literal's `value` is not a node. */
	const childrenOf = (target) => {
		const included = Array.isArray(target.includes) ? target.includes.map((ref) => ({ kind: 'ref', ref })) : [];
		const nested = [...(target.anyOf ?? []), target.items, target.values, target.value];
		return [...included, ...nested.filter((candidate) => typeof candidate?.kind === 'string')];
	};

	const visited = new Set();
	const visit = (node) => {
		if (node.kind === 'ref') {
			if (visited.has(node.ref)) return;
			visited.add(node.ref);
		}
		const target = resolve(node);
		for (const [name, property] of target.kind === 'object' ? Object.entries(target.properties) : []) {
			visit(property.node);
			if (!discriminators.has(name) && !acceptsFunction(property.node)) property.node = { kind: 'scriptable', value: property.node };
		}
		for (const child of childrenOf(target)) visit(child);
	};
	for (const ref of configRefs) visit(definitions[ref].properties.options.node);
}
