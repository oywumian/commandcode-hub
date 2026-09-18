import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminAuth } from '../src/admin-auth.mjs';

test('admin authentication issues and verifies a signed cookie', () => {
  const auth = createAdminAuth({ adminPassword: 'correct', sessionSecret: 'session-secret', production: false });
  const request = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(auth.login(request, 'wrong').ok, false);
  const login = auth.login(request, 'correct');
  assert.equal(login.ok, true);
  request.headers.cookie = login.cookie.split(';')[0];
  assert.equal(auth.isAuthenticated(request), true);
});

test('admin authentication locks after five failed attempts', () => {
  const auth = createAdminAuth({ adminPassword: 'correct', sessionSecret: 'session-secret', production: false });
  const request = { headers: {}, socket: { remoteAddress: '10.0.0.1' } };
  for (let i = 0; i < 5; i++) auth.login(request, 'wrong');
  assert.equal(auth.login(request, 'correct').status, 429);
});
