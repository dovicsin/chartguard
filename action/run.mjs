import { appendFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { runAsEntryPoint } from '../tools/shared/entry.mjs';

/**
 * The ChartGuard GitHub Action (CG-06-08): runs the CLI in this process with the step's inputs, which
 * arrive as environment variables (`INPUT_*`, never interpolated into a script), and reports as a
 * workflow wants it: each finding an annotation (`--format github`), optionally a SARIF file for code
 * scanning, a line in the job summary, and the exit code as an output. The step fails as the CLI's
 * `--fail-on` decides.
 */

const COMMANDS = ['validate', 'analyze', 'quality'];
const FAIL_ON = ['error', 'warning', 'never'];

/** An input's value as GitHub passes it (`INPUT_<NAME>`, upper case, `-` kept), trimmed; '' when unset. */
const input = (env, name) => (env[`INPUT_${name.toUpperCase()}`] ?? '').trim();

/** A multi-line input: one value per line (a CRLF's CR trimmed with the spaces), blank lines left out. */
const lines = (env, name) =>
	input(env, name)
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '');

/** A refused input: the step fails with the reason, before anything runs. */
export class ActionInputError extends Error {
	name = 'ActionInputError';
}

function choice(env, name, allowed, fallback) {
	const value = input(env, name) || fallback;
	if (value !== '' && !allowed.includes(value))
		throw new ActionInputError(`input ${name}: "${value}" is not one of ${allowed.join(', ')}`);
	return value;
}

/**
 * The CLI arguments the inputs ask for, the format left out (each run names its own). Every value is
 * one argument: a file pattern with spaces stays one pattern, and an input cannot add options.
 */
export function argumentsOf(env) {
	const command = choice(env, 'command', COMMANDS, 'validate');
	const failOn = choice(env, 'fail-on', FAIL_ON, '');
	const single = [
		['library', '--library'],
		['config', '--config'],
		['library-version', '--library-version'],
		['project', '--project']
	].flatMap(([name, option]) => (input(env, name) === '' ? [] : [option, input(env, name)]));
	const many = [
		['files', '--file'],
		['ignore', '--ignore']
	].flatMap(([name, option]) => lines(env, name).flatMap((value) => [option, value]));
	return [command, ...single, ...many, ...(failOn === '' ? [] : ['--fail-on', failOn])];
}

/** A path an input names, relative to the workspace the workflow checked out. */
const inWorkspace = (env, path) => (isAbsolute(path) ? path : join(env.GITHUB_WORKSPACE ?? process.cwd(), path));

/** Runs the CLI's `main` with `argv`, collecting what it prints. */
async function captured(main, argv) {
	const out = [];
	const err = [];
	const code = await main(argv, { out: (line) => out.push(line), err: (line) => err.push(line) });
	return { code, out, err };
}

/**
 * Runs the action: annotations on stdout, messages on stderr, the SARIF file and the outputs and job
 * summary GitHub reads. Resolves to the exit code the step ends with.
 */
export async function runAction({ env, main, stdout, stderr }) {
	let argv;
	try {
		argv = argumentsOf(env);
	} catch (error) {
		if (!(error instanceof ActionInputError)) throw error;
		stderr(`ChartGuard: ${error.message}`);
		return 2;
	}
	const annotated = await captured(main, [...argv, '--format', 'github']);
	for (const line of annotated.out) stdout(line);
	for (const line of annotated.err) stderr(line);
	const sarif = input(env, 'sarif-file');
	// Input the CLI could not use (exit 2) has no findings to log.
	if (sarif !== '' && annotated.code !== 2) {
		const log = await captured(main, [...argv, '--format', 'sarif']);
		writeFileSync(inWorkspace(env, sarif), `${log.out.join('\n')}\n`);
	}
	reportToGitHub(env, annotated);
	return annotated.code;
}

/** The step's `exit-code` output, and the summary line in the job summary, where GitHub gives their files. */
function reportToGitHub(env, { code, out }) {
	if (env.GITHUB_OUTPUT !== undefined) appendFileSync(env.GITHUB_OUTPUT, `exit-code=${String(code)}\n`);
	const summary = out.at(-1);
	if (env.GITHUB_STEP_SUMMARY !== undefined && summary?.startsWith('ChartGuard:') === true)
		appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

await runAsEntryPoint(import.meta.url, async () => {
	// The CLI to run: the one this action built, or the published version the step installed.
	const cli =
		process.env.CHARTGUARD_CLI ?? resolve(import.meta.dirname, '..', 'packages', 'cli', 'bin', 'chartguard.mjs');
	const { main } = await import(pathToFileURL(cli).href);
	const write = (stream) => (line) => stream.write(`${line}\n`);
	return runAction({ env: process.env, main, stdout: write(process.stdout), stderr: write(process.stderr) });
});
