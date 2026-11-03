import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { runAsEntryPoint } from '../../../../tools/shared/entry.mjs';

/** The extension package, wherever this script is run from (E7). */
const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(PACKAGE, 'dist');
export const NOTICES = join(DIST, 'THIRD-PARTY-NOTICES.txt');

/** What a VSIX holds of code: two CommonJS bundles, the extension (VS Code provides `vscode`) and the server. */
const COMMON = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', metafile: true, logLevel: 'warning' };

/** Whether `directory` is a package's root: a package.json with a name (a nested one may only set `type`). */
function isPackageRoot(directory) {
	const manifest = join(directory, 'package.json');
	return existsSync(manifest) && typeof JSON.parse(readFileSync(manifest, 'utf8')).name === 'string';
}

/** The package a bundled file comes from: the nearest package root above it. */
function packageOf(file, known) {
	for (let directory = dirname(file); ; directory = dirname(directory)) {
		if (known.has(directory) || isPackageRoot(directory)) return directory;
		if (dirname(directory) === directory) return undefined;
	}
}

/** Code-unit order, never by locale (D12). */
export const byCodeUnit = (a, b) => (a < b ? -1 : Number(a > b));

/** A package's licence and notice files, as it ships them. */
const legalFiles = (directory) =>
	readdirSync(directory)
		.filter((name) => /^(licen[cs]e|notice|copying)(\.|$)/iu.test(name))
		.sort()
		.map((name) => readFileSync(join(directory, name), 'utf8').trim());

/**
 * Every package a bundle holds code of, with its licence and notices: a bundle publishes their code,
 * so it carries what they ask to be carried (E: everything published carries its upstream notice).
 */
export function noticesOf(inputs) {
	const packages = new Set();
	for (const input of inputs) {
		const directory = packageOf(resolve(input), packages);
		if (directory !== undefined && directory !== PACKAGE.replace(/[\\/]$/u, '')) packages.add(directory);
	}
	const entries = [...packages].map((directory) => {
		const { name, version, license } = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
		return { name, text: [`${name} ${version} (${String(license)})`, ...legalFiles(directory)].join('\n\n') };
	});
	entries.sort((a, b) => byCodeUnit(a.name, b.name));
	return entries;
}

/** Bundles the extension and the server from the compiled sources, and writes the notices of what they hold. */
export async function bundle() {
	const extension = await build({
		...COMMON,
		entryPoints: [join(DIST, 'extension.js')],
		outfile: join(DIST, 'extension.cjs'),
		external: ['vscode']
	});
	const server = await build({ ...COMMON, entryPoints: [join(DIST, 'server.js')], outfile: join(DIST, 'server.cjs') });
	const inputs = [...Object.keys(extension.metafile.inputs), ...Object.keys(server.metafile.inputs)];
	const entries = noticesOf(inputs);
	const separator = `\n\n${'-'.repeat(72)}\n\n`;
	writeFileSync(NOTICES, `${entries.map(({ text }) => text).join(separator)}\n`);
	return { inputs, packages: entries.map(({ name }) => name) };
}

await runAsEntryPoint(import.meta.url, async () => {
	await bundle();
});
