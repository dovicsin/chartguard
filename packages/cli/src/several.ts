import { EXIT_OK, EXIT_USAGE } from './exit-codes.js';
import { githubCommands } from './github.js';
import type { Format } from './invocation.js';
import type { Io } from './io.js';
import type { CheckedFile, UnusableFile } from './report.js';
import { printJson } from './report.js';
import { type RunProperties, sarifLog } from './sarif.js';

/** How the files are printed: the format, whether the invocation names several, and the config file read. */
interface PrintOptions {
	readonly format: Format;
	readonly several: boolean;
	readonly config: string | undefined;
}

/** The first line of a text report completed from a config file. */
export const settingsNote = (config: string): string => `Settings from ${config}.`;

/** One file's report as before; several as `{ mode, files }`, a file that could not be used with its reason. */
function jsonOf(mode: string, results: readonly (CheckedFile | UnusableFile)[], several: boolean): object {
	const [only] = results;
	if (!several && only !== undefined && 'findings' in only) return { mode, ...only.json };
	return { mode, files: results.map((result) => ('error' in result ? result : { file: result.file, ...result.json })) };
}

/** The run's properties over several files: partial as soon as one is. */
function mergedProperties(files: readonly CheckedFile[], mode: string): RunProperties {
	const [first] = files;
	const partial = files.some(({ properties }) => properties['coverage'] === 'partial');
	return {
		...first?.properties,
		mode,
		...(first?.properties['coverage'] === undefined ? {} : { coverage: partial ? 'partial' : 'full' })
	};
}

/** The text report: the config file read, then each file's report (under `== <file>` when there are several). */
function printText(checked: readonly CheckedFile[], { several, config }: Omit<PrintOptions, 'format'>, io: Io): void {
	if (config !== undefined) io.out(settingsNote(config));
	for (const result of checked) {
		if (several) io.out(`== ${result.file}`);
		result.text(io);
	}
}

/**
 * The files one command checked, printed in one format (CG-06-02 part 2). One file as before;
 * several (whenever the invocation can name several): text grouped under `== <file>`, JSON as
 * `{ mode, files: [...] }`, SARIF as one log. A file that could not be used is listed with its
 * reason (and on stderr), the others are still printed, and the run exits 2; otherwise the worst
 * status of the files.
 */
export function printFiles(
	mode: string,
	results: readonly (CheckedFile | UnusableFile)[],
	{ format, several, config }: PrintOptions,
	io: Io
): number {
	const checked = results.filter((result): result is CheckedFile => 'findings' in result);
	const unusable = results.filter((result): result is UnusableFile => 'error' in result);
	for (const { error } of unusable) io.err(`ChartGuard: ${error}`);
	const findings = checked.flatMap((result) => result.findings);
	if (format === 'sarif') {
		const properties = { ...mergedProperties(checked, mode), ...(config === undefined ? {} : { config }) };
		printJson(sarifLog(findings, properties), io);
	} else if (format === 'github') for (const line of githubCommands(findings)) io.out(line);
	else if (format === 'json') printJson(jsonOf(mode, results, several), io);
	else printText(checked, { several, config }, io);
	if (unusable.length > 0) return EXIT_USAGE;
	return Math.max(EXIT_OK, ...checked.map(({ exitCode }) => exitCode));
}
