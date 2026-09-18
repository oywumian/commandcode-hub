import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHubApp } from '../src/server.mjs';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => server.close(resolve));

test('admin models proxy returns only the upstream model catalog', async () => {
  let requestedPath = '';
  const internal = http.createServer((req, res) => {
    requestedPath = req.url;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [
      { id: 'gpt-test', object: 'model', owned_by: 'command-code' },
    ] }));
  });
  const internalPort = await listen(internal);
  const store = {
    getSessionVersion: () => 1,
    verifyAdminPassword: (value) => value === 'admin',
    getDefaultAccountWithKey: () => ({ id: 'account-1', apiKey: 'user_real_key' }),
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
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/models`, { headers: { Cookie: cookie } });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(requestedPath, '/v1/models');
    assert.deepEqual(data.models, [{ id: 'gpt-test', object: 'model', owned_by: 'command-code' }]);
  } finally {
    await close(server);
    await close(internal);
  }
});
