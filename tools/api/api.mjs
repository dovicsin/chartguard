import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAsEntryPoint } from '../shared/entry.mjs';
import { compareSurfaces, parseSurface, publishedEntryPoints, surfaceText } from './surface.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const SURFACES = join(ROOT, 'tools', 'api', 'surfaces');

const fileOf = (packageName) => join(SURFACES, `${packageName.replace('@', '').replace('/', '__')}.api.md`);

/** Each published package's current surface text, by package. */
export function currentSurfaces() {
	const byPackage = new Map();
	for (const entry of publishedEntryPoints(ROOT)) byPackage.set(entry.packageName, [...(byPackage.get(entry.packageName) ?? []), entry]);
	return new Map([...byPackage].map(([packageName, entries]) => [packageName, surfaceText(entries)]));
}

function write(surfaces) {
	mkdirSync(SURFACES, { recursive: true });
	for (const [packageName, text] of surfaces) writeFileSync(fileOf(packageName), text);
	process.stdout.write(`${String(surfaces.size)} API surfaces recorded in ${SURFACES}\n`);
	return 0;
}

/** Every difference from the recorded surfaces, breaking first; true when there is any. */
function report(packageName, text) {
	const file = fileOf(packageName);
	const recorded = existsSync(file) ? parseSurface(readFileSync(file, 'utf8')) : new Map();
	const { breaking, additive } = compareSurfaces(recorded, parseSurface(text));
	for (const line of breaking) process.stdout.write(`BREAKING ${packageName}: ${line}\n`);
	for (const line of additive) process.stdout.write(`additive ${packageName}: ${line}\n`);
	return breaking.length + additive.length > 0;
}

/** `check`: report every difference from the recorded surfaces; `write`: record the current ones. */
async function main([command = 'check']) {
	const surfaces = currentSurfaces();
	if (command === 'write') return write(surfaces);
	const differs = [...surfaces].map(([packageName, text]) => report(packageName, text)).some(Boolean);
	if (differs)
		process.stdout.write('The public API changed: review the lines above, choose the version bump, then run `npm run api:write`.\n');
	return differs ? 1 : 0;
}

await runAsEntryPoint(import.meta.url, main);
