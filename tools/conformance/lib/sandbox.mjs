import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const CHILD = fileURLToPath(new URL('../sandbox/child.mjs', import.meta.url));
const TIMEOUT_MS = 300_000;

/** `--permission` (Node 22.13+), `--experimental-permission` (Node 20); undefined when neither exists. */
function permissionFlag() {
	const flags = process.allowedNodeEnvironmentFlags;
	if (flags.has('--permission')) return '--permission';
	return flags.has('--experimental-permission') ? '--experimental-permission' : undefined;
}

/**
 * The child's environment: nothing but where coverage is collected. Example code can reach the
 * host realm's `process` through any object handed to its `vm` context (K6), so it must find no
 * tokens or paths there.
 */
function emptyEnvironment() {
	const coverage = process.env.NODE_V8_COVERAGE;
	return coverage === undefined ? {} : { NODE_V8_COVERAGE: coverage };
}

/**
 * Runs a pinned upstream example corpus in a separate Node process under the permission model:
 * the repository is readable, nothing is writable, no child processes or workers can be started,
 * and the environment is empty. The network is not closed (Node's permission model has no switch
 * for it); the corpora are hash-pinned (E12). Returns undefined when this Node version has no
 * permission model, so upstream example code is never run without isolation.
 */
export function runCorpus(library, corpusPath) {
	const flag = permissionFlag();
	if (flag === undefined) return undefined;
	const child = spawnSync(process.execPath, [flag, `--allow-fs-read=${ROOT}`, CHILD, library, corpusPath], {
		encoding: 'utf8',
		env: emptyEnvironment(),
		maxBuffer: 64 * 1024 * 1024,
		timeout: TIMEOUT_MS
	});
	if (child.status !== 0) throw new Error(`conformance sandbox failed (${String(child.status)}): ${child.stderr}`);
	return JSON.parse(child.stdout);
}
