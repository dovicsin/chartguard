import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type Diagnostic, isRecord, type QualityReport, type ValidationResult } from '@chartguard/core';

import { codeFingerprint } from './fingerprint.js';
import type { Io } from './io.js';

/**
 * The result cache (CG-06-02 part 4d): a file's result stored under a key of everything it depends
 * on, and reused when the key is the same. An entry that cannot be read, holds another key or does
 * not have the result's shape is a miss, never a result; a location that cannot be written is said
 * once on stderr, and the run is otherwise unchanged.
 */
const FORMAT = 'chartguard-result-cache-1';

export interface ResultCache {
	/** The result stored for `parts` when it has the shape `is` checks; else `compute()`, stored when it is plain JSON. */
	readonly through: <T>(parts: unknown, is: (value: unknown) => value is T, compute: () => Promise<T>) => Promise<T>;
}

/**
 * Whether a value survives `JSON.stringify` and `JSON.parse` unchanged (E20): strings, finite
 * numbers, booleans, null, dense lists and plain objects; a property that is `undefined` is
 * dropped, as every printer drops it.
 */
function plainJson(value: unknown): boolean {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
	if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0);
	if (Array.isArray(value))
		return value.length === Object.keys(value).length && value.every((item: unknown) => plainJson(item));
	if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
	return Object.values(value).every((item) => item === undefined || plainJson(item));
}

export async function openCache(location: string, io: Io): Promise<ResultCache> {
	const code = await codeFingerprint();
	let unwritable = false;
	const keyOf = (parts: unknown): string =>
		createHash('sha256')
			.update(JSON.stringify([FORMAT, code, parts]))
			.digest('hex');
	const read = async (key: string): Promise<unknown> => {
		try {
			const entry: unknown = JSON.parse(await readFile(join(location, `${key}.json`), 'utf8'));
			return isRecord(entry) && entry['key'] === key ? entry['result'] : undefined;
		} catch {
			return undefined;
		}
	};
	const write = async (key: string, result: unknown): Promise<void> => {
		try {
			await mkdir(location, { recursive: true });
			const temporary = join(location, `${key}.${String(process.pid)}.tmp`);
			await writeFile(temporary, JSON.stringify({ key, result }));
			await rename(temporary, join(location, `${key}.json`));
		} catch (error) {
			if (unwritable) return;
			unwritable = true;
			io.err(`ChartGuard: cache not written: ${error instanceof Error ? error.message : String(error)}`);
		}
	};
	return {
		through: async (parts, is, compute) => {
			const key = keyOf(parts);
			const stored = await read(key);
			if (is(stored)) return stored;
			const result = await compute();
			if (plainJson(result)) await write(key, result);
			return result;
		}
	};
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
const SEVERITIES: readonly unknown[] = ['error', 'warning', 'info'];

/** A stored diagnostic's shape: the fields every printer reads. */
function isDiagnostic(value: unknown): value is Diagnostic {
	if (!isRecord(value) || !SEVERITIES.includes(value['severity'])) return false;
	return ['code', 'message', 'path', 'confidence'].every((field) => isString(value[field]));
}

const isDiagnostics = (value: unknown): value is Diagnostic[] => Array.isArray(value) && value.every(isDiagnostic);

/** A stored validation result's shape. */
export function isValidationResult(value: unknown): value is ValidationResult {
	if (!isRecord(value) || typeof value['valid'] !== 'boolean' || !isDiagnostics(value['diagnostics'])) return false;
	const { schemaDigest, extensions } = value;
	return (
		['status', 'library', 'schemaVersion', 'coverage'].every((field) => isString(value[field])) &&
		(schemaDigest === undefined || isString(schemaDigest)) &&
		(extensions === undefined || isStrings(extensions))
	);
}

/** A stored quality report's shape. */
export function isQualityReport(value: unknown): value is QualityReport {
	if (!isRecord(value) || !isString(value['library']) || !isString(value['rulesVersion'])) return false;
	const { diagnostics, suppressed, disabled } = value;
	const held = (item: unknown): boolean =>
		isRecord(item) && isDiagnostic(item['diagnostic']) && isString(item['by']) && isString(item['reason']);
	return isDiagnostics(diagnostics) && Array.isArray(suppressed) && suppressed.every(held) && isStrings(disabled);
}
