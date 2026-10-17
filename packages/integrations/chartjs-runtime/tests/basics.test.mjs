import assert from 'node:assert/strict';
import test from 'node:test';

import { validateBeforeCreate } from '../dist/index.js';
test('factory invoked after validation', () =>
	assert.equal(
		validateBeforeCreate({ type: 'bar', data: { datasets: [] } }, () => 37),
		37
	));

test('factory is never invoked for a confirmed invalid config', () => {
	let created = false;
	assert.throws(() =>
		validateBeforeCreate(42, () => {
			created = true;
		})
	);
	assert.equal(created, false);
});
