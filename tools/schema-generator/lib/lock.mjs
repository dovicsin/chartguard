import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Upstream pin from upstream-sources.json, verified against what npm actually installed. */
export function verifiedUpstream(root, library) {
	const sources = JSON.parse(readFileSync(join(root, 'tools/schema-generator/upstream-sources.json'), 'utf8'));
	const pin = sources.libraries.find((entry) => entry.library === library);
	if (pin === undefined) throw new Error(`No upstream pin for ${library}`);
	const installed = JSON.parse(readFileSync(join(root, 'node_modules', pin.package, 'package.json'), 'utf8'));
	const locked = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')).packages[`node_modules/${pin.package}`];
	if (installed.version !== pin.version || locked?.version !== pin.version)
		throw new Error(`${pin.package}: installed ${installed.version}, pinned ${pin.version}`);
	if (locked.integrity !== pin.integrity) throw new Error(`${pin.package}: lockfile integrity differs from the pin`);
	return pin;
}
