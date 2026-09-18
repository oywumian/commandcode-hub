import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminAuth } from '../src/admin-auth.mjs';

function authStore(initial = 'correct') {
  let password = initial;
  let version = 1;
  return {
    getSessionVersion: () => version,
    verifyAdminPassword: (value) => value === password,
    changeAdminPassword(value) { password = value; version += 1; return version; },
  };
}

test('admin authentication issues and verifies a signed cookie', () => {
  const auth = createAdminAuth({ sessionSecret: 'session-secret', production: false }, authStore());
  const request = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(auth.login(request, 'wrong').ok, false);
  const login = auth.login(request, 'correct');
  assert.equal(login.ok, true);
  request.headers.cookie = login.cookie.split(';')[0];
  assert.equal(auth.isAuthenticated(request), true);
});

test('admin authentication locks after five failed attempts', () => {
  const auth = createAdminAuth({ sessionSecret: 'session-secret', production: false }, authStore());
  const request = { headers: {}, socket: { remoteAddress: '10.0.0.1' } };
  for (let i = 0; i < 5; i++) auth.login(request, 'wrong');
  assert.equal(auth.login(request, 'correct').status, 429);
});

test('changing the password invalidates existing sessions', () => {
  const store = authStore();
  const auth = createAdminAuth({ sessionSecret: 'session-secret', production: false }, store);
  const request = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  const login = auth.login(request, 'correct');
  request.headers.cookie = login.cookie.split(';')[0];
  assert.equal(auth.isAuthenticated(request), true);
  auth.changePassword('new-password');
  assert.equal(auth.isAuthenticated(request), false);
  assert.equal(auth.login({ headers: {}, socket: request.socket }, 'new-password').ok, true);
});
