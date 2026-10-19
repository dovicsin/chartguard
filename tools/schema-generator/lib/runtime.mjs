import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Facts the declarations leave out are read from the pinned package's runtime code and cite the
 * line they come from (`echarts/lib/component/dataZoom/installCommon.js:52`). A pattern that is no
 * longer found fails generation: the runtime changed, and the fact must be re-established.
 */
function locate(root, packageName, { file, pattern }) {
	const lines = readFileSync(join(root, 'node_modules', packageName, file), 'utf8').split('\n');
	const index = lines.findIndex((line) => line.includes(pattern));
	if (index === -1) throw new Error(`${packageName} runtime changed: "${pattern}" not found in ${file}`);
	return { lines, index, pointer: `${packageName}/${file}:${String(index + 1)}` };
}

export function runtimePointer(root, packageName, fact) {
	return locate(root, packageName, fact).pointer;
}

/** The lines after the one matching `pattern`, up to (not including) the first that starts with `end`. */
export function runtimeSection(root, packageName, { end, ...fact }) {
	const { lines, index, pointer } = locate(root, packageName, fact);
	const length = lines.slice(index + 1).findIndex((line) => line.trimStart().startsWith(end));
	if (length === -1) throw new Error(`${packageName} runtime changed: no "${end}" after ${pointer}`);
	return { pointer, lines: lines.slice(index + 1, index + 1 + length) };
}

/** An authoritative provenance record citing one runtime line of the pinned package. */
export function runtimeProvenance(root, { sourceId, packageName }, fact) {
	return { confidence: 'authoritative', sources: [{ source: sourceId, pointer: runtimePointer(root, packageName, fact) }] };
}
