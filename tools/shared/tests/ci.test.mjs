import assert from 'node:assert/strict';
import test from 'node:test';

import { isCi, skipOutsideCi } from '../ci.mjs';

test('the usual CI services are recognised, not only CI=...', () => {
	for (const name of ['CI', 'GITHUB_ACTIONS', 'BUILDKITE', 'JENKINS_URL', 'GITLAB_CI', 'TF_BUILD'])
		assert.equal(isCi({ [name]: 'true' }), true, name);
	assert.equal(isCi({ JENKINS_URL: 'https://ci.example/' }), true);
	assert.equal(isCi({}), false);
	assert.equal(isCi({ CI: '' }), false);
	assert.equal(isCi({ CI: 'false' }), false);
	assert.equal(isCi({ HOME: '/home/x' }), false);
});

test('a missing prerequisite is a skip locally and a failure on CI (E22)', () => {
	assert.equal(skipOutsideCi('needs a built playground', {}), 'needs a built playground');
	assert.throws(
		() => skipOutsideCi('needs a built playground', { GITHUB_ACTIONS: 'true' }),
		/CI cannot skip: needs a built playground/
	);
});
