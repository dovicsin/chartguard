import assert from 'node:assert/strict';
import test from 'node:test';

import p from '../dist/index.js';
test('does not claim unimplemented rules', () => assert.deepEqual(p.rules, {}));
