import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptSecret, encryptSecret, hashPassword, hashSecret, maskSecret, safeEqual, verifyPassword } from '../src/secrets.mjs';

test('secrets encrypt, decrypt, mask, and reject tampering', () => {
  const encrypted = encryptSecret('user_secret_123456', 'master-password');
  assert.equal(decryptSecret(encrypted, 'master-password'), 'user_secret_123456');
  assert.equal(maskSecret('user_secret_123456'), 'user_sec...3456');
  assert.equal(hashSecret('a'), hashSecret('a'));
  assert.equal(safeEqual('same', 'same'), true);
  assert.equal(safeEqual('same', 'different'), false);
  const parts = encrypted.split('.');
  const bytes = Buffer.from(parts[3], 'base64url');
  bytes[0] ^= 1;
  parts[3] = bytes.toString('base64url');
  assert.throws(() => decryptSecret(parts.join('.'), 'master-password'));
});

test('password hashes are salted and verifiable', () => {
  const first = hashPassword('secret1');
  const second = hashPassword('secret1');
  assert.notEqual(first, second);
  assert.equal(verifyPassword('secret1', first), true);
  assert.equal(verifyPassword('wrong', first), false);
});
