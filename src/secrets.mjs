import crypto from 'node:crypto';

const VERSION = 'v1';
const PASSWORD_VERSION = 's1';

export function deriveKey(masterKey) {
  return crypto.scryptSync(masterKey, 'commandcode-hub:v1', 32);
}

export function encryptSecret(value, masterKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(masterKey), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, encrypted].map((part) => Buffer.isBuffer(part) ? part.toString('base64url') : part).join('.');
}

export function decryptSecret(value, masterKey) {
  const [version, iv, tag, encrypted] = String(value).split('.');
  if (version !== VERSION || !iv || !tag || !encrypted) throw new Error('Unsupported encrypted secret');
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(masterKey), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}

export function hashSecret(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function hashPassword(value) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(value), salt, 64);
  return `${PASSWORD_VERSION}.${salt.toString('base64url')}.${hash.toString('base64url')}`;
}

export function verifyPassword(value, encoded) {
  const [version, salt, expected] = String(encoded || '').split('.');
  if (version !== PASSWORD_VERSION || !salt || !expected) return false;
  try {
    const expectedBuffer = Buffer.from(expected, 'base64url');
    const actual = crypto.scryptSync(String(value), Buffer.from(salt, 'base64url'), expectedBuffer.length);
    return crypto.timingSafeEqual(actual, expectedBuffer);
  } catch {
    return false;
  }
}

export function maskSecret(value) {
  if (!value) return '';
  return value.length <= 12 ? `${value.slice(0, 4)}...` : `${value.slice(0, 8)}...${value.slice(-4)}`;
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
