import { applyEdit, type TextEdit } from './edits.js';

/**
 * The editor text and the fixes applied to it. A fix replaces one range and selects it; "Undo fix"
 * restores the text before the last fixes, as long as the user has not typed since (typing drops
 * them: an undo would discard what was typed).
 */
export class EditorText {
	private readonly before: string[] = [];

	constructor(
		private readonly area: HTMLTextAreaElement,
		private readonly undoButton: HTMLButtonElement,
		private readonly changed: () => void
	) {
		undoButton.addEventListener('click', () => {
			this.undo();
		});
		this.sync();
	}

	get value(): string {
		return this.area.value;
	}

	/** Replaces the whole text (an example, a shared link): nothing to undo. */
	set(text: string): void {
		this.area.value = text;
		this.typed();
	}

	/** The user typed: earlier fixes can no longer be undone. */
	typed(): void {
		this.before.length = 0;
		this.sync();
	}

	apply(edit: TextEdit): void {
		const text = this.area.value;
		this.before.push(text);
		this.area.value = applyEdit(text, edit);
		this.area.focus();
		this.area.setSelectionRange(edit.start, edit.start + edit.text.length);
		this.sync();
		this.changed();
	}

	undo(): void {
		const text = this.before.pop();
		if (text === undefined) return;
		this.area.value = text;
		this.sync();
		this.changed();
	}

	private sync(): void {
		this.undoButton.hidden = this.before.length === 0;
	}
}
