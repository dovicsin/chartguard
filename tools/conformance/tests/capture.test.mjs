import assert from 'node:assert/strict';
import test from 'node:test';

import { observe, verdictOf } from '../lib/capture.mjs';

test('the console is captured during the render and restored afterwards, also after a throw', () => {
	const { warn, error } = console;
	const quiet = observe(() => undefined);
	assert.deepEqual(quiet, { threw: undefined, messages: [] });
	const noisy = observe(() => {
		console.warn('careful', 1);
		console.error('broken');
		throw new Error('boom');
	});
	assert.deepEqual(noisy, {
		threw: 'boom',
		messages: [
			{ channel: 'warn', text: 'careful 1' },
			{ channel: 'error', text: 'broken' }
		]
	});
	assert.equal(
		observe(() => {
			throw 'text';
		}).threw,
		'text'
	);
	assert.equal(console.warn, warn);
	assert.equal(console.error, error);
});

test('verdicts: rejected on a throw or an error message, complained on warnings only', () => {
	assert.equal(verdictOf({ threw: undefined, messages: [] }), 'accepted');
	assert.equal(verdictOf({ threw: undefined, messages: [{ channel: 'warn', text: 'x' }] }), 'complained');
	assert.equal(verdictOf({ threw: undefined, messages: [{ channel: 'error', text: 'x' }] }), 'rejected');
	assert.equal(verdictOf({ threw: 'x', messages: [] }), 'rejected');
});
