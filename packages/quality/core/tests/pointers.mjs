import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const POINTER =
	/'((?:[\w.-]+)@(\d+\.\d+\.\d+) ([\w./-]+):(\d+) [^']*)'|"((?:[\w.-]+)@(\d+\.\d+\.\d+) ([\w./-]+):(\d+) [^"]*)"/g;
const PARTS = /^([\w.-]+)@(\d+\.\d+\.\d+) ([\w./-]+):(\d+) (.+)$/;

/** `checkPointers` over every module of a package's `src`; returns how many pointers it checked. */
export function checkPackagePointers(testUrl) {
	const directory = new URL('../src/', testUrl);
	return readdirSync(directory)
		.filter((file) => file.endsWith('.ts'))
		.reduce((count, file) => count + checkPointers(fileURLToPath(new URL(file, directory))), 0);
}

/**
 * Every runtime-default pointer written in `source` (`<package>@<version> <file>:<line> <text>`) names
 * the installed, pinned version and a line of that file that holds the text. Returns how many it checked.
 */
export function checkPointers(source) {
	const text = readFileSync(source, 'utf8');
	const pointers = [...text.matchAll(POINTER)].map((match) => match[1] ?? match[5]);
	for (const pointer of pointers) {
		const [, name, version, file, line, quoted] = PARTS.exec(pointer);
		const manifest = JSON.parse(readFileSync(`${ROOT}node_modules/${name}/package.json`, 'utf8'));
		assert.equal(manifest.version, version, `${pointer}: installed ${name} is ${manifest.version}`);
		const lines = readFileSync(`${ROOT}node_modules/${name}/${file}`, 'utf8').split('\n');
		assert.ok(
			lines[Number(line) - 1]?.includes(quoted.trim()),
			`${pointer}: line ${line} is "${lines[Number(line) - 1]?.trim()}"`
		);
	}
	return pointers.length;
}
