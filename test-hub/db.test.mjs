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
  const store = createStore({
    dataDir, masterKey: 'test-master', adminPassword: 'admin1', gatewayApiKey: 'bootstrap-key',
    quotaRetentionDays: 90, requestRetentionDays: 7,
  });
  try {
    assert.equal(store.authenticateGatewayKey('bootstrap-key').name, 'Bootstrap key');
    const extra = store.createGatewayKey('CLI', 'second-key');
    assert.equal(store.authenticateGatewayKey('second-key').id, extra.id);
    store.updateGatewayKey(extra.id, { enabled: false });
    assert.equal(store.authenticateGatewayKey('second-key'), null);
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
