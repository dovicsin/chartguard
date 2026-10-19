import { runtimePointer } from './runtime.mjs';

/**
 * Where echarts 6.1.0 declares less than its runtime reads, shown by the official examples once
 * recursive definitions were checked at every depth (CG-02-03): the matrix dimension reads every
 * level of cells with the same `traverseInitCells` (lib/coord/matrix/MatrixDim.js), where a cell is
 * a string or an object, while the declarations allow strings only at the top level.
 */
const CELLS = {
	file: 'lib/coord/matrix/MatrixDim.js',
	pattern: 'var childrenSpan = traverseInitCells(cellOption.children, firstLeafLocator, level + 1);'
};

const changed = (what) => new Error(`echarts types changed: ${what}`);

/** New definitions where a matrix cell's `children` also take strings, citing the runtime line. */
export function withRuntimeFacts(root, definitions) {
	const cell = definitions.MatrixDimensionCellOption;
	const children = cell?.properties.children;
	if (children?.node.kind !== 'array') throw changed('MatrixDimensionCellOption.children');
	const pointer = runtimePointer(root, 'echarts', CELLS);
	const items = { kind: 'union', anyOf: [{ kind: 'string' }, children.node.items] };
	const provenance = {
		...children.provenance,
		sources: [...children.provenance.sources, { source: 'echarts', pointer }]
	};
	const widened = { ...children, node: { kind: 'array', items }, provenance };
	return {
		...definitions,
		MatrixDimensionCellOption: { ...cell, properties: { ...cell.properties, children: widened } }
	};
}
