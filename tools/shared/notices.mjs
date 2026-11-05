import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

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

/** A package's licence and notice files, as it ships them, with LF line ends (a tracked copy is checked out with LF). */
const legalFiles = (directory) =>
	readdirSync(directory)
		.filter((name) => /^(licen[cs]e|notice|copying)(\.|$)/iu.test(name))
		.sort()
		.map((name) => readFileSync(join(directory, name), 'utf8').replaceAll(/\r\n?/gu, '\n').trim());

/**
 * One entry per package directory, with its licence and notices, in code-unit order of their names: the
 * same package and version installed twice (a nested copy) is one entry, since it says the same.
 */
export function packageNotices(directories) {
	const entries = [...new Set(directories)].map((directory) => {
		const { name, version, license } = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
		return { name, text: [`${name} ${version} (${String(license)})`, ...legalFiles(directory)].join('\n\n') };
	});
	const unique = [...new Map(entries.map((entry) => [entry.text, entry])).values()];
	unique.sort((a, b) => byCodeUnit(a.name, b.name) || byCodeUnit(a.text, b.text));
	return unique;
}

/**
 * Every package a bundle holds code of (`inputs`: the bundler's metafile inputs), with its licence and
 * notices: a bundle publishes their code, so it carries what they ask to be carried (E58). `own`: the
 * directory of the package that makes the bundle, left out.
 */
export function noticesOf(inputs, own) {
	const packages = new Set();
	const ownDirectory = resolve(own);
	for (const input of inputs) {
		const directory = packageOf(resolve(input), packages);
		if (directory !== undefined && directory !== ownDirectory) packages.add(directory);
	}
	return packageNotices(packages);
}

/** The notices file's text: each package's entry, separated by a rule. */
export const noticesText = (entries) => `${entries.map(({ text }) => text).join(`\n\n${'-'.repeat(72)}\n\n`)}\n`;
