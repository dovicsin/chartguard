import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Facts the declarations leave out are read from the pinned package's runtime code and cite the
 * line they come from (`echarts/lib/component/dataZoom/installCommon.js:52`). A pattern that is no
 * longer found fails generation: the runtime changed, and the fact must be re-established.
 */
export function runtimePointer(root, packageName, { file, pattern }) {
	const lines = readFileSync(join(root, 'node_modules', packageName, file), 'utf8').split('\n');
	const index = lines.findIndex((line) => line.includes(pattern));
	if (index === -1) throw new Error(`${packageName} runtime changed: "${pattern}" not found in ${file}`);
	return `${packageName}/${file}:${String(index + 1)}`;
}

/** An authoritative provenance record citing one runtime line of the pinned package. */
export function runtimeProvenance(root, { sourceId, packageName }, fact) {
	return { confidence: 'authoritative', sources: [{ source: sourceId, pointer: runtimePointer(root, packageName, fact) }] };
}
