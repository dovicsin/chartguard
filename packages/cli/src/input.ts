import { readFile } from 'node:fs/promises';

import type { Diagnostic } from '@chartguard/core';

import { InputError } from './errors.js';

const BOM = '﻿';

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function readText(file: string): Promise<string> {
	try {
		const text = await readFile(file, 'utf8');
		return text.startsWith(BOM) ? text.slice(BOM.length) : text;
	} catch (error) {
		throw new InputError(`Cannot read ${file}: ${describeError(error)}`);
	}
}

export async function readJson(file: string): Promise<unknown> {
	return (await readJsonText(file)).value;
}

/** A JSON file's value and its text (for the positions of findings in it). */
export async function readJsonText(file: string): Promise<{ readonly value: unknown; readonly text: string }> {
	const text = await readText(file);
	try {
		return { value: JSON.parse(text) as unknown, text };
	} catch (error) {
		throw new InputError(`${file} is not valid JSON: ${describeError(error)}`);
	}
}

/** Why nothing read from a source file is reliable: its syntax errors, or why it was not read at all. */
export function describeUnreadable(file: string, diagnostics: readonly Diagnostic[]): string {
	const lines = diagnostics.map(
		({ line, column, message }) => `\n  ${String(line ?? 1)}:${String(column ?? 1)} ${message}`
	);
	return `${file} cannot be read reliably; nothing read from it is used.${lines.join('')}`;
}
