/** The element with `id`, checked to be of the expected kind: the markup is static, a mismatch is a bug. */
function byId<T extends HTMLElement>(id: string, kind: new () => T): T {
	const found = document.getElementById(id);
	if (!(found instanceof kind)) throw new Error(`playground markup: #${id} is missing or not a ${kind.name}`);
	return found;
}

/** The page's elements (static markup in static/index.html). */
export const ui = {
	library: byId('library', HTMLSelectElement),
	mode: byId('mode', HTMLSelectElement),
	example: byId('example', HTMLSelectElement),
	share: byId('share', HTMLButtonElement),
	notice: byId('notice', HTMLParagraphElement),
	hint: byId('editor-hint', HTMLElement),
	editor: byId('editor', HTMLTextAreaElement),
	undo: byId('undo', HTMLButtonElement),
	syntax: byId('syntax', HTMLParagraphElement),
	validator: byId('validator-verdict', HTMLSpanElement),
	runtime: byId('runtime-verdict', HTMLSpanElement),
	schema: byId('schema', HTMLSpanElement),
	chartField: byId('chart-field', HTMLLabelElement),
	chart: byId('chart', HTMLSelectElement),
	run: byId('run', HTMLButtonElement),
	preview: byId('preview', HTMLDivElement),
	messages: byId('runtime-messages', HTMLUListElement),
	runtimeNote: byId('runtime-note', HTMLParagraphElement),
	summary: byId('summary', HTMLParagraphElement),
	diagnostics: byId('diagnostics', HTMLOListElement),
	quality: byId('quality', HTMLOListElement),
	expected: byId('expected', HTMLElement)
};
