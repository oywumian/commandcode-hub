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

test('database stores model eligibility independently for each account', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'commandcode-hub-models-'));
  const store = createStore({
    dataDir, masterKey: 'test-master', adminPassword: 'admin1', gatewayApiKey: 'bootstrap-key',
    quotaRetentionDays: 90, requestRetentionDays: 7,
  });
  try {
    const first = store.createAccount({ name: 'First', apiKey: 'user_first', report: report('first') });
    const second = store.createAccount({ name: 'Second', apiKey: 'user_second', report: report('second') });
    store.saveAccountModelTest(first.id, { modelId: 'shared-model', enabled: false, status: 'unavailable', error: 'MODEL_NOT_IN_PLAN' });
    store.saveAccountModelTest(second.id, { modelId: 'shared-model', enabled: true, status: 'available', error: '' });
    assert.equal(store.isAccountModelEnabled(first.id, 'shared-model'), false);
    assert.equal(store.isAccountModelEnabled(second.id, 'shared-model'), true);
    assert.equal(store.listAccountModelStates(first.id)[0].status, 'unavailable');
    store.deleteAccount(first.id);
    assert.deepEqual(store.listAccountModelStates(first.id), []);
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('database reports daily model tokens and measured credit deltas', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'commandcode-hub-usage-'));
  const store = createStore({
    dataDir, masterKey: 'test-master', adminPassword: 'admin1', gatewayApiKey: 'bootstrap-key',
    quotaRetentionDays: 90, requestRetentionDays: 7,
  });
  try {
    const account = store.createAccount({ name: 'Usage', apiKey: 'user_usage', report: report('usage') });
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const dayStart = start.getTime();
    store.db.prepare('INSERT INTO quota_snapshots (account_id, captured_at, monthly_remaining) VALUES (?, ?, ?)').run(account.id, dayStart + 1000, 10);
    store.db.prepare('INSERT INTO quota_snapshots (account_id, captured_at, monthly_remaining) VALUES (?, ?, ?)').run(account.id, dayStart + 2000, 8.25);
    store.addRequestLog({ accountId: account.id, path: '/v1/chat/completions', model: 'model-a', status: 200, durationMs: 10, inputTokens: 100, outputTokens: 20 });
    store.addRequestLog({ accountId: account.id, path: '/v1/chat/completions', model: 'model-a', status: 200, durationMs: 10, inputTokens: 50, outputTokens: 5 });
    const usage = store.modelUsageToday(account.id, dayStart);
    assert.equal(usage.totalTokens, 175);
    assert.equal(usage.models[0].totalTokens, 175);
    assert.equal(store.confirmedCreditsUsedToday(account.id, dayStart).value, 1.75);
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
