import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldPrintBackendLine } from './run.js';

test('backend output filter suppresses optional MJLab validation import noise', () => {
  assert.equal(
    shouldPrintBackendLine("Failed to import warp: No module named 'warp'"),
    false
  );
  assert.equal(
    shouldPrintBackendLine("Failed to import mujoco_warp: No module named 'warp'"),
    false
  );
});

test('backend output filter still prints actionable backend failures', () => {
  assert.equal(shouldPrintBackendLine('RuntimeError: failed to open robot file'), true);
  assert.equal(shouldPrintBackendLine('Traceback (most recent call last):'), true);
});
