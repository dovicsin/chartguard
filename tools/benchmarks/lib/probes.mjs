import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAsEntryPoint } from '../../shared/entry.mjs';
import { fastest, reference } from './measure.mjs';

/**
 * Measurements that need a fresh process (CG-07-03): what a first use costs, and the peak memory of
 * a process that did only that. Each prints one JSON line; `measure.mjs` `probe` checks its shape.
 */

/** The process's peak resident memory so far, in MB. */
const peakMb = () => process.resourceUsage().maxRSS / 1024;

/** The reference unit in this process, after the measured work (so its warm-up is not the work's). */
const referenceMs = () => fastest([reference], 3)[0];

/** Importing a library's validator and its first validation. */
export async function cold(library) {
	const start = performance.now();
	const { validate } = await import(`@chartguard/config-${library}`);
	validate({});
	const ms = performance.now() - start;
	return { ms, rss: peakMb(), unit: referenceMs() };
}

/** A file of the project: a chart whose axis is a constant every file imports. */
const projectFile = (index) =>
	[
		"import { Chart } from 'chart.js';",
		"import { AXIS } from './shared';",
		`const config = { type: 'bar', data: { labels: ['a'], datasets: [{ label: 'a', data: [${String(index)}] }] }, options: { scales: { y: AXIS } } } as const;`,
		"new Chart(document.createElement('canvas'), config);",
		''
	].join('\n');

/** An editor's buffer of the project's first file, with `min` written at the axis. */
const buffer = (min) =>
	[
		"import { Chart } from 'chart.js';",
		`new Chart(document.createElement('canvas'), { type: 'bar', data: { datasets: [] }, options: { scales: { y: { min: ${JSON.stringify(min)} } } } });`,
		''
	].join('\n');

/** A `files`-file project in `directory`: each file a chart whose axis is a constant they all import. */
function writeProject(directory, files) {
	writeFileSync(
		join(directory, 'tsconfig.json'),
		JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['*.ts'] })
	);
	writeFileSync(join(directory, 'shared.ts'), 'export const AXIS = { min: 0 } as const;\n');
	for (let index = 0; index < files; index += 1)
		writeFileSync(join(directory, `c${String(index)}.ts`), projectFile(index));
}

/** An editor on `file` whose project is open: each `edit` re-checks a new wrong value, counting its findings. */
function editing(checker, file, directory) {
	checker.check(buffer(0), file, directory);
	let round = 0;
	let findings = 0;
	return {
		edit: () => {
			round += 1;
			findings = checker.check(buffer(`x${String(round)}`), file, directory).length;
		},
		findings: () => findings
	};
}

/**
 * The editors' check in project mode, in a `files`-file project: opening it (a new checker's first
 * check) and a re-check after an edit that writes a wrong value, each the fastest of runs
 * interleaved with the reference unit. The first opening in the process is left out of the timing:
 * most of it is compiling TypeScript itself (about 300 ms, then about 130 ms an opening), which load
 * stretches more than it stretches the reference. Peak memory is read after that first opening. The
 * count of findings shows the edit was checked: a re-check that found nothing would measure no
 * work. The project is removed however the probe ends.
 */
export async function project(files) {
	const { SourceChecker } = await import('@chartguard/source-checks');
	const directory = mkdtempSync(join(tmpdir(), 'chartguard-bench-'));
	try {
		writeProject(directory, Number(files));
		const file = join(directory, 'c0.ts');
		const opened = () => new SourceChecker({ project: true }, 'chartguard').check(buffer(0), file, directory);
		opened();
		const rss = peakMb();
		const editor = editing(new SourceChecker({ project: true }, 'chartguard'), file, directory);
		const [open, edit, unit] = fastest([opened, editor.edit, reference], 4);
		return { open, edit, findings: editor.findings(), rss, unit };
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

const PROBES = { cold, project };

await runAsEntryPoint(import.meta.url, async ([name, ...args]) => {
	const run = PROBES[name];
	if (run === undefined) {
		process.stderr.write(`unknown probe ${String(name)} (${Object.keys(PROBES).join(', ')})\n`);
		return 2;
	}
	process.stdout.write(`${JSON.stringify(await run(...args))}\n`);
	return 0;
});
