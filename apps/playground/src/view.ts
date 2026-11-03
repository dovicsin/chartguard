import type { Offer } from './edits.js';
import type { Example } from './examples.js';
import type { Item } from './shown.js';

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

function fixNode(offer: Offer, onApply: (offer: Offer) => void): HTMLElement {
	const node = element('div', 'finding__fix');
	const button = element('button', 'finding__apply', offer.label);
	button.type = 'button';
	button.addEventListener('click', () => {
		onApply(offer);
	});
	node.append(button);
	if (offer.note !== undefined) node.append(element('span', 'finding__effect', offer.note));
	return node;
}

/** What a finding's controls do: select the text it is about, apply its fix. */
export interface ItemActions {
	readonly select: (item: Item) => void;
	readonly apply: (offer: Offer) => void;
}

function findingItem(item: Item, actions: ItemActions): HTMLLIElement {
	const node = element('li', `finding finding--${item.severity}`);
	const button = element('button', 'finding__select');
	button.type = 'button';
	button.title = 'Show in the editor';
	button.append(
		element('span', 'finding__severity', item.severity),
		element('code', 'finding__code', item.code),
		element('code', 'finding__path', item.path)
	);
	button.addEventListener('click', () => {
		actions.select(item);
	});
	node.append(button, element('p', 'finding__message', item.message));
	if (item.suggestion !== undefined) node.append(element('p', 'finding__suggestion', item.suggestion));
	if (item.offer !== undefined) node.append(fixNode(item.offer, actions.apply));
	return node;
}

export function findingItems(items: readonly Item[], actions: ItemActions, empty: string): HTMLLIElement[] {
	if (items.length === 0) return [element('li', 'finding finding--none', empty)];
	return items.map((item) => findingItem(item, actions));
}

/**
 * The findings the lists show (`code path`), each with a click on its fix button when it has one:
 * read from the page as shown, for the self-test to act as a user does.
 */
export function shownOffers(
	...lists: readonly HTMLElement[]
): { readonly finding: string; readonly apply: (() => void) | undefined }[] {
	const items = lists.flatMap((list) => [...list.querySelectorAll('.finding:not(.finding--none)')]);
	return items.map((item) => {
		const code = item.querySelector('.finding__code')?.textContent ?? '';
		const path = item.querySelector('.finding__path')?.textContent ?? '';
		const button = item.querySelector('.finding__apply');
		const apply =
			button instanceof HTMLButtonElement
				? (): void => {
						button.click();
					}
				: undefined;
		return { finding: `${code} ${path}`, apply };
	});
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
