import { checkArtifact } from '../dist/index.js';

export const NPM = { kind: 'npm-package', locator: 'demo@1.2.3', integrity: 'sha512-abc', license: 'MIT' };
export const DOCS = {
	kind: 'docs-tree',
	locator: 'https://example.test/tree.json',
	license: 'MIT',
	retrieved: '2026-10-17'
};
export const typed = (pointer) => ({ confidence: 'authoritative', sources: [{ source: 'npm', pointer }] });
export const prop = (node, extra = {}) => ({ node, provenance: typed('Options'), ...extra });

export function artifact(root, overrides = {}) {
	return {
		irVersion: 1,
		library: 'demo',
		libraryVersion: '1.2.3',
		coverage: 'full',
		generator: { name: 'test', version: '0.0.0' },
		sources: { npm: NPM, docs: DOCS },
		definitions: {},
		root,
		...overrides
	};
}

export const closedRoot = {
	kind: 'object',
	additional: 'closed',
	provenance: typed('Options'),
	properties: {
		type: prop(
			{
				kind: 'union',
				anyOf: [
					{ kind: 'literal', value: 'bar' },
					{ kind: 'literal', value: 'line' }
				]
			},
			{ required: true }
		),
		height: prop({ kind: 'number' })
	}
};

export const problems = (value) => checkArtifact(value).problems;
