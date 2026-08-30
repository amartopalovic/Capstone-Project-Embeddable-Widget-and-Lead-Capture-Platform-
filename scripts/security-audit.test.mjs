import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { inspectLine } from './scan-secrets.mjs';
import { waitForChild } from './mongo-tool.mjs';

test('scanner never prints token prefixes and does not exempt whole placeholder lines', () => {
  const synthetic = 'ghp_' + 'A'.repeat(36);
  for (const suffix of ['', ' lead@example.invalid', ' replace-me-with-placeholder']) {
    const findings = inspectLine(synthetic + suffix);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, 'GitHub token');
    assert.equal(JSON.stringify(findings).includes(synthetic.slice(0, 24)), false);
    assert.match(findings[0].fingerprint, /^[a-f0-9]{12}$/);
  }
});

test('backup child errors never contain stderr or raw spawn errors', async () => {
  for (const event of ['close', 'error']) {
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    const done = waitForChild(child, 'synthetic-tool');
    child.stderr.write('AUDIT_PRIVATE_SENTINEL@example.invalid');
    if (event === 'close') child.emit('close', 1, null);
    else child.emit('error', new Error('AUDIT_PRIVATE_SENTINEL'));
    await assert.rejects(done, (error) => {
      assert.equal(error.message.includes('AUDIT_PRIVATE_SENTINEL'), false);
      assert.match(error.message, /sensitive details suppressed/);
      return true;
    });
    child.stderr.destroy();
  }
});
