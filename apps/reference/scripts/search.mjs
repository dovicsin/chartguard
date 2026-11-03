import { CODES } from './codes.mjs';
import { pageName } from './pages.mjs';

/** Markdown reduced to words a search matches: no markup, one line. */
const plain = (text) =>
	text
		.replaceAll(/```[\s\S]*?```/gu, ' ')
		.replaceAll(/[`*_#>|[\]()]/gu, ' ')
		.replaceAll(/\s+/gu, ' ')
		.trim();

/** The first sentence of a text, as a result's summary. */
const summary = (text) => /^.*?[.!?](?:\s|$)/u.exec(plain(text))?.[0].trim() ?? plain(text).slice(0, 160);

/**
 * What the search page finds (CG-06-07): every package, export, code and rule, with the page and
 * anchor it is on, a kind, a title, a summary and the words it matches.
 */
export function searchIndex({ packages, apis, rules }) {
	const packageEntries = packages.map(({ name, description, readme }) => ({
		kind: 'package',
		title: name,
		url: `packages/${pageName(name)}.html`,
		summary: description,
		text: plain(readme)
	}));
	const exportEntries = apis.flatMap(({ specifier, exports }) =>
		exports.map(({ name, kind, doc }) => ({
			kind,
			title: name,
			url: `api/${pageName(specifier)}.html#${name}`,
			summary: `${specifier}${doc === '' ? '' : `: ${summary(doc)}`}`,
			text: plain(doc)
		}))
	);
	const codeEntries = CODES.map(({ code, title, meaning, action }) => ({
		kind: 'code',
		title: code,
		url: `codes.html#${code}`,
		summary: title,
		text: plain(`${title} ${meaning} ${action}`)
	}));
	const ruleEntries = rules.map(({ code, id, title, rationale }) => ({
		kind: 'rule',
		title: code,
		url: `rules.html#${code}`,
		summary: `${id}: ${title}`,
		text: plain(`${id} ${title} ${rationale}`)
	}));
	return [...codeEntries, ...ruleEntries, ...exportEntries, ...packageEntries];
}
