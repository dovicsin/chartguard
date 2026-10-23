import type { Diagnostic } from '@chartguard/core';

import type { Example } from './examples.js';

/**
 * DOM builders: each returns new nodes and changes nothing it was given; `main.ts` places them.
 * Text that may come from the user's config (keys inside messages, paths) is only ever assigned
 * through `textContent`; nothing here parses HTML.
 */
function element<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className: string,
	text = ''
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	node.className = className;
	node.textContent = text;
	return node;
}

export function badge(text: string, tone: string): HTMLSpanElement {
	const node = element('span', 'badge', text);
	node.dataset['tone'] = tone;
	return node;
}

function diagnosticItem(diagnostic: Diagnostic, onSelect: (path: string) => void): HTMLLIElement {
	const item = element('li', `finding finding--${diagnostic.severity}`);
	const button = element('button', 'finding__select');
	button.type = 'button';
	button.title = 'Show in the editor';
	button.append(
		element('span', 'finding__severity', diagnostic.severity),
		element('code', 'finding__code', diagnostic.code),
		element('code', 'finding__path', diagnostic.path)
	);
	button.addEventListener('click', () => {
		onSelect(diagnostic.path);
	});
	item.append(button, element('p', 'finding__message', diagnostic.message));
	if (diagnostic.suggestion !== undefined) item.append(element('p', 'finding__suggestion', diagnostic.suggestion));
	return item;
}

export function diagnosticItems(
	diagnostics: readonly Diagnostic[],
	onSelect: (path: string) => void,
	empty: string
): HTMLLIElement[] {
	if (diagnostics.length === 0) return [element('li', 'finding finding--none', empty)];
	return diagnostics.map((diagnostic) => diagnosticItem(diagnostic, onSelect));
}

export function messageItems(messages: readonly string[]): HTMLLIElement[] {
	return messages.map((message) => element('li', 'runtime-message', message));
}

/** For a contract example: what the validator and the runtime are pinned to, and why they differ. */
export function expectationNodes(example: Example | undefined): HTMLElement[] {
	const expected = example?.expected;
	if (expected === undefined) return [];
	const findings = expected.findings.length === 0 ? 'no findings' : expected.findings.join(', ');
	const nodes: HTMLElement[] = [
		element('h3', 'expectation__title', 'Pinned in the conformance table'),
		element('p', 'expectation__line', `Validator: ${findings}`),
		element('p', 'expectation__line', `Runtime: ${expected.runtime}`)
	];
	if (expected.why !== undefined) nodes.push(element('p', 'expectation__why', expected.why));
	return nodes;
}

export interface Choice {
	readonly value: string;
	readonly label: string;
	readonly group?: string;
}

function optionElement({ value, label }: Choice): HTMLOptionElement {
	const option = element('option', '', label);
	option.value = value;
	return option;
}

/** `<option>`s, inside one `<optgroup>` per distinct `group`, in first-seen order. */
export function choiceNodes(choices: readonly Choice[]): HTMLElement[] {
	const nodes: HTMLElement[] = [];
	const groups = new Map<string, HTMLOptGroupElement>();
	for (const choice of choices) {
		if (choice.group === undefined) {
			nodes.push(optionElement(choice));
			continue;
		}
		const group = groups.get(choice.group) ?? element('optgroup', '');
		if (!groups.has(choice.group)) {
			group.label = choice.group;
			groups.set(choice.group, group);
			nodes.push(group);
		}
		group.append(optionElement(choice));
	}
	return nodes;
}
