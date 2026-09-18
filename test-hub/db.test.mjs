import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/db.mjs';

const report = (name) => ({
  fetchedAt: Date.now(),
  account: { id: name, userName: name },
  plan: { planId: 'individual-pro', name: 'Pro' },
  normalized: { credits: {}, monthly: null, usage: null, failures: [] },
  raw: {},
});

test('database maintains one enabled default account', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'commandcode-hub-'));
  const store = createStore({ dataDir, masterKey: 'test-master', quotaRetentionDays: 90, requestRetentionDays: 7 });
  try {
    const first = store.createAccount({ name: 'First', apiKey: 'user_first', report: report('first') });
    const second = store.createAccount({ name: 'Second', apiKey: 'user_second', report: report('second') });
    assert.equal(first.isDefault, true);
    assert.equal(second.isDefault, false);
    assert.equal(store.setDefault(second.id).isDefault, true);
    store.updateAccount(second.id, { enabled: false });
    assert.equal(store.getDefaultAccountWithKey().id, first.id);
    assert.equal(store.deleteAccount(first.id), true);
    assert.equal(store.getDefaultAccountWithKey(), undefined);
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
