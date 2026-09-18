import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHubApp } from '../src/server.mjs';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => server.close(resolve));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('model availability is persisted per account and filters the gateway catalog', async () => {
  const upstreamRequests = [];
  const internal = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    upstreamRequests.push({ url: req.url, model: body.model });

    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [
        { id: 'vendor-a/available-model', object: 'model', owned_by: 'vendor-a' },
        { id: 'vendor-b/blocked-model', object: 'model', owned_by: 'vendor-b' },
      ] }));
      return;
    }
    if (req.url === '/v1/chat/completions' && body.model === 'blocked-model') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'MODEL_NOT_IN_PLAN: blocked-model is unavailable', type: 'authentication_error' } }));
      return;
    }
    if (req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'chat-1', object: 'chat.completion', choices: [] }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  const internalPort = await listen(internal);

  const states = new Map();
  const account = {
    id: 'account-1', name: 'Primary', enabled: true, isDefault: true, apiKey: 'user_primary_key',
  };
  const store = {
    getSessionVersion: () => 1,
    verifyAdminPassword: (value) => value === 'admin',
    authenticateGatewayKey: (value) => value === 'gateway-secret' ? { id: 'gateway-1' } : null,
    getAccountWithKey: (id) => id === account.id ? account : null,
    getAccount: (id) => id === account.id ? account : null,
    getDefaultAccountWithKey: () => account,
    listAccountModelStates: () => [...states.values()],
    saveAccountModelTest: (_accountId, result) => states.set(result.modelId, result),
    isAccountModelEnabled: (_accountId, modelId) => !states.has(modelId) || states.get(modelId).enabled,
    addRequestLog: () => {},
    addTerminalEvent: () => {},
  };
  const config = {
    internalHost: '127.0.0.1', internalPort, maxBodyBytes: 1024 * 1024, production: false,
    adminPassword: 'admin', sessionSecret: 'session',
  };
  const app = createHubApp(config, store, { distDir: 'missing' });
  const server = http.createServer(app.handler);
  const port = await listen(server);

  try {
    const login = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'admin' }),
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const started = await fetch(`http://127.0.0.1:${port}/api/admin/models/test`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: account.id }),
    });
    assert.equal(started.status, 202);

    let job;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await fetch(`http://127.0.0.1:${port}/api/admin/models/test?accountId=${account.id}`, { headers: { Cookie: cookie } });
      job = (await response.json()).job;
      if (job.status !== 'running') break;
      await delay(20);
    }
    assert.equal(job.status, 'completed');
    assert.equal(job.available, 1);
    assert.equal(job.unavailable, 1);
    assert.equal(states.get('blocked-model').enabled, false);

    const adminModels = await fetch(`http://127.0.0.1:${port}/api/admin/models?accountId=${account.id}`, { headers: { Cookie: cookie } });
    const adminData = await adminModels.json();
    assert.equal(adminData.models.find((model) => model.id === 'available-model').status, 'available');
    assert.equal(adminData.models.find((model) => model.id === 'blocked-model').enabled, false);

    const gatewayModels = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { Authorization: 'Bearer gateway-secret' },
    });
    const gatewayData = await gatewayModels.json();
    assert.deepEqual(gatewayData.data.map((model) => model.id), ['available-model']);

    const blocked = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer gateway-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'blocked-model', messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(blocked.status, 400);

    const allowed = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer gateway-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'available-model', messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(allowed.status, 200);
    assert.equal(upstreamRequests.some((request) => request.url === '/v1/chat/completions' && request.model === 'available-model'), true);
  } finally {
    await close(server);
    await close(internal);
  }
});
