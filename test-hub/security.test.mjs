import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/db.mjs';
import { createHubApp } from '../src/server.mjs';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => server.close(resolve));

test('admin manages multiple gateway keys and changes a six-character password', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'commandcode-security-'));
  const config = {
    dataDir, masterKey: 'test-master', adminPassword: 'admin1', gatewayApiKey: 'bootstrap-key', sessionSecret: 'session',
    quotaRetentionDays: 90, requestRetentionDays: 7, internalHost: '127.0.0.1', internalPort: 1,
    maxBodyBytes: 1024 * 1024, production: false, host: '127.0.0.1', port: 0, quotaRefreshMs: 300000,
  };
  const store = createStore(config);
  const app = createHubApp(config, store, { distDir: 'missing' });
  const server = http.createServer(app.handler);
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  const request = (path, options = {}) => fetch(`${base}${path}`, options);
  try {
    const login = await request('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'admin1' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const createdResponse = await request('/api/admin/security/api-keys', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'OpenCode', password: 'admin1' }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.match(created.apiKey, /^sk-[a-f0-9]{64}$/);

    const settings = await (await request('/api/admin/security', { headers: { Cookie: cookie } })).json();
    assert.equal(settings.apiKeys.length, 2);
    assert.equal(settings.apiKeys.some((key) => key.name === 'OpenCode'), true);

    assert.equal((await request('/v1/models', { headers: { Authorization: 'Bearer bootstrap-key' } })).status, 503);
    assert.equal((await request('/v1/models', { headers: { Authorization: `Bearer ${created.apiKey}` } })).status, 503);

    assert.equal((await request(`/api/admin/security/api-keys/${created.key.id}`, {
      method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }),
    })).status, 200);
    assert.equal((await request('/v1/models', { headers: { Authorization: `Bearer ${created.apiKey}` } })).status, 401);

    const bootstrap = settings.apiKeys.find((key) => key.name === 'Bootstrap key');
    assert.equal((await request(`/api/admin/security/api-keys/${bootstrap.id}`, {
      method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }),
    })).status, 400);

    const changed = await request('/api/admin/security/password', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'admin1', newPassword: 'new123' }),
    });
    assert.equal(changed.status, 200);
    assert.equal((await request('/api/admin/security', { headers: { Cookie: cookie } })).status, 401);
    assert.equal((await request('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'new123' }),
    })).status, 200);
  } finally {
    await close(server);
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
