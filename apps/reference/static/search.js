/**
 * The reference's search (CG-06-07): every query word must occur in an entry's title, summary or
 * text; entries whose title holds a word come first. Results are built with `textContent` only.
 */
const MAX_RESULTS = 50;

const field = document.getElementById('query');
const status = document.getElementById('status');
const results = document.getElementById('results');

/** Whether every word occurs in the entry, and how well: 2 when the title holds one, 1 otherwise, 0 not at all. */
function score(entry, words) {
	const title = entry.title.toLowerCase();
	const all = `${title} ${entry.summary.toLowerCase()} ${entry.text.toLowerCase()}`;
	if (!words.every((word) => all.includes(word))) return 0;
	return words.some((word) => title.includes(word)) ? 2 : 1;
}

function item(entry) {
	const node = document.createElement('li');
	const link = document.createElement('a');
	link.href = entry.url;
	link.textContent = entry.title;
	const kind = document.createElement('span');
	kind.className = 'kind';
	kind.textContent = entry.kind;
	const text = document.createElement('p');
	text.textContent = entry.summary;
	node.append(link, ' ', kind, text);
	return node;
}

function show(index, query) {
	const words = query
		.toLowerCase()
		.split(/\s+/u)
		.filter((word) => word !== '');
	if (words.length === 0) {
		results.replaceChildren();
		status.textContent = `${String(index.length)} entries: codes, rules, exports and packages.`;
		return;
	}
	const found = index
		.map((entry) => ({ entry, rank: score(entry, words) }))
		.filter(({ rank }) => rank > 0)
		.sort((a, b) => b.rank - a.rank);
	results.replaceChildren(...found.slice(0, MAX_RESULTS).map(({ entry }) => item(entry)));
	status.textContent =
		found.length === 0
			? 'Nothing found.'
			: `${String(found.length)} found${found.length > MAX_RESULTS ? `, the first ${String(MAX_RESULTS)} shown` : ''}.`;
}

async function start() {
	const index = await (await fetch('search-index.json')).json();
	const query = new URLSearchParams(location.search).get('q') ?? '';
	field.value = query;
	field.addEventListener('input', () => {
		show(index, field.value);
		history.replaceState(null, '', field.value === '' ? location.pathname : `?q=${encodeURIComponent(field.value)}`);
	});
	show(index, query);
	document.body.dataset.ready = 'true';
}

void start();
