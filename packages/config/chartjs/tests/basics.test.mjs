import assert from 'node:assert/strict';
import test from 'node:test';

import { validate } from '../dist/index.js';
test('rejects nonobject root', () => assert.equal(validate(42).status, 'invalid'));
