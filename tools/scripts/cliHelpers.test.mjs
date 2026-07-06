import assert from 'node:assert/strict';
import test from 'node:test';

import { readUnknownErrorMessage } from './cliHelpers.js';

test('readUnknownErrorMessage returns Error messages', () => {
  assert.equal(readUnknownErrorMessage(new Error('boom')), 'boom');
});

test('readUnknownErrorMessage stringifies non-Error values', () => {
  assert.equal(readUnknownErrorMessage('plain failure'), 'plain failure');
  assert.equal(readUnknownErrorMessage(404), '404');
});
