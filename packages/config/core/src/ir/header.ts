import { isRecord } from '@chartguard/core';

import { SCHEMA_IR_VERSION, SOURCE_KINDS } from './types.js';

export type Report = (path: string, message: string) => void;

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const DIGEST = /^sha256-[0-9a-f]{64}$/;
const COVERAGES: ReadonlySet<unknown> = new Set(['partial', 'full']);
const SOURCE_KIND_SET: ReadonlySet<unknown> = new Set(SOURCE_KINDS);

export function quote(value: unknown): string {
	return typeof value === 'string' ? `"${value}"` : typeof value;
}

function isOptionalString(value: unknown): boolean {
	return value === undefined || typeof value === 'string';
}

export function checkHeader(artifact: Record<string, unknown>, report: Report): void {
	if (artifact['irVersion'] !== SCHEMA_IR_VERSION) report('$.irVersion', `expected ${String(SCHEMA_IR_VERSION)}`);
	const library = artifact['library'];
	if (typeof library !== 'string' || library === '') report('$.library', 'expected a non-empty string');
	const version = artifact['libraryVersion'];
	if (typeof version !== 'string' || !EXACT_VERSION.test(version))
		report('$.libraryVersion', `expected an exact version, got ${quote(version)}`);
	if (!COVERAGES.has(artifact['coverage'])) report('$.coverage', 'expected "partial" or "full"');
	const generator = artifact['generator'];
	if (!isRecord(generator) || typeof generator['name'] !== 'string' || typeof generator['version'] !== 'string')
		report('$.generator', 'expected { name, version } strings');
	checkDigest(artifact['digest'], report);
}

function checkDigest(digest: unknown, report: Report): void {
	if (digest !== undefined && (typeof digest !== 'string' || !DIGEST.test(digest)))
		report('$.digest', `expected sha256-<64 hex digits>, got ${quote(digest)}`);
}

function checkSource(source: unknown, path: string, report: Report): void {
	if (!isRecord(source)) {
		report(path, 'expected an object');
		return;
	}
	if (!SOURCE_KIND_SET.has(source['kind'])) report(path, `unknown source kind ${quote(source['kind'])}`);
	if (typeof source['locator'] !== 'string') report(path, 'expected a locator string');
	if (typeof source['license'] !== 'string') report(path, 'expected a license string');
	if (!isOptionalString(source['integrity']) || !isOptionalString(source['retrieved']))
		report(path, 'integrity and retrieved must be strings when present');
}

export function checkSources(sources: unknown, report: Report): Record<string, unknown> {
	if (!isRecord(sources)) {
		report('$.sources', 'expected an object');
		return {};
	}
	for (const [id, source] of Object.entries(sources)) checkSource(source, `$.sources.${id}`, report);
	return sources;
}
