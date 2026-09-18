import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHubApp } from '../src/server.mjs';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => server.close(resolve));

test('gateway validates its key and injects the selected account key', async () => {
  let upstreamHeaders;
  const internal = http.createServer(async (req, res) => {
    upstreamHeaders = req.headers;
    for await (const _ of req) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'ok', usage: { prompt_tokens: 2, completion_tokens: 1 } }));
  });
  const internalPort = await listen(internal);
  const logs = [];
  const terminalEvents = [];
  const store = {
    getSessionVersion: () => 1,
    verifyAdminPassword: (value) => value === 'admin',
    changeAdminPassword: () => 2,
    authenticateGatewayKey: (value) => value === 'gateway-secret' ? { id: 'gateway-1' } : null,
    getDefaultAccountWithKey: () => ({ id: 'account-1', apiKey: 'user_real_key' }),
    addRequestLog: (log) => logs.push(log),
    addTerminalEvent: (event) => terminalEvents.push(event),
    listTerminalEvents: ({ limit } = {}) => terminalEvents.slice(0, limit),
    clearTerminalEvents: () => { terminalEvents.length = 0; },
    terminalStats: () => ({ totalRequests: 1, cacheHitRate: 0, lastLatencyMs: 10, lastTtftMs: 3, lastClient: 'Codex', lastModel: 'test-model' }),
  };
  const config = {
    gatewayApiKey: 'gateway-secret', internalHost: '127.0.0.1', internalPort,
    maxBodyBytes: 1024 * 1024, production: false, adminPassword: 'admin', sessionSecret: 'session',
  };
  const app = createHubApp(config, store, { distDir: 'missing' });
  const gateway = http.createServer(app.handler);
  const gatewayPort = await listen(gateway);
  try {
    const denied = await fetch(`http://127.0.0.1:${gatewayPort}/v1/chat/completions`, { method: 'POST', body: '{}' });
    assert.equal(denied.status, 401);
    const response = await fetch(`http://127.0.0.1:${gatewayPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer gateway-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test-model', stream: false }),
    });
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(upstreamHeaders.authorization, 'Bearer user_real_key');
    assert.equal(upstreamHeaders['x-api-key'], 'user_real_key');
    assert.equal(logs[0].model, 'test-model');
    assert.equal(logs[0].inputTokens, 2);
    assert.equal(terminalEvents.map((event) => event.event).join(','), 'received,upstream,first_byte,completed');
    assert.equal(terminalEvents.at(-1).inputTokens, 2);
    assert.equal(terminalEvents.at(-1).outputTokens, 1);

    const login = await fetch(`http://127.0.0.1:${gatewayPort}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'admin' }),
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const terminal = await fetch(`http://127.0.0.1:${gatewayPort}/api/admin/terminal`, { headers: { Cookie: cookie } });
    const terminalData = await terminal.json();
    assert.equal(terminal.status, 200);
    assert.equal(terminalData.events.at(-1).event, 'completed');
    assert.equal(terminalData.stats.lastModel, 'test-model');
    const cleared = await fetch(`http://127.0.0.1:${gatewayPort}/api/admin/terminal/clear`, { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(cleared.status, 200);
    assert.equal(terminalEvents.length, 0);
  } finally {
    await close(gateway);
    await close(internal);
  }
});
