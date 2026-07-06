import assert from 'node:assert/strict';
import test from 'node:test';

import { readErrorLikeMessage, readUnknownErrorMessage } from './cliHelpers.js';

test('readUnknownErrorMessage returns Error messages', () => {
  assert.equal(readUnknownErrorMessage(new Error('boom')), 'boom');
});

test('readUnknownErrorMessage stringifies non-Error values', () => {
  assert.equal(readUnknownErrorMessage('plain failure'), 'plain failure');
  assert.equal(readUnknownErrorMessage(404), '404');
});

test('readErrorLikeMessage returns string messages from error-like values', () => {
  assert.equal(readErrorLikeMessage(new Error('boom')), 'boom');
  assert.equal(readErrorLikeMessage({ message: 'probe failed' }), 'probe failed');
  assert.equal(readErrorLikeMessage({ message: 503 }), '503');
});

test('readErrorLikeMessage stringifies values without useful messages', () => {
  assert.equal(readErrorLikeMessage(new Error('')), 'Error');
  assert.equal(readErrorLikeMessage({ message: '' }), '[object Object]');
  assert.equal(readErrorLikeMessage(null), 'null');
});
