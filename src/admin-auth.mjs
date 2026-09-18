import crypto from 'node:crypto';
import { safeEqual } from './secrets.mjs';

const COOKIE = 'cc_hub_session';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createAdminAuth(config, store) {
  const attempts = new Map();
  let sessionVersion = store.getSessionVersion();

  function createToken() {
    const payload = Buffer.from(JSON.stringify({ exp: Date.now() + TTL_MS, ver: sessionVersion, nonce: crypto.randomBytes(12).toString('hex') })).toString('base64url');
    return `${payload}.${sign(payload, config.sessionSecret)}`;
  }

  function verifyToken(token) {
    const [payload, signature] = String(token || '').split('.');
    if (!payload || !signature || !safeEqual(signature, sign(payload, config.sessionSecret))) return false;
    try {
      const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return Number.isFinite(value.exp) && value.exp > Date.now() && value.ver === sessionVersion;
    } catch {
      return false;
    }
  }

  function cookieValue(req, token) {
    const secure = config.production || req.headers['x-forwarded-proto'] === 'https';
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TTL_MS / 1000}${secure ? '; Secure' : ''}`;
  }

  function getToken(req) {
    const cookies = String(req.headers.cookie || '').split(';');
    for (const cookie of cookies) {
      const [name, ...rest] = cookie.trim().split('=');
      if (name === COOKIE) return rest.join('=');
    }
    return '';
  }

  function clientIp(req) {
    return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  }

  return {
    isAuthenticated: (req) => verifyToken(getToken(req)),
    login(req, password) {
      const ip = clientIp(req);
      const state = attempts.get(ip) || { count: 0, blockedUntil: 0 };
      if (state.blockedUntil > Date.now()) return { ok: false, status: 429, error: 'Too many login attempts' };
      if (!store.verifyAdminPassword(password)) {
        state.count += 1;
        if (state.count >= 5) {
          state.count = 0;
          state.blockedUntil = Date.now() + 5 * 60 * 1000;
        }
        attempts.set(ip, state);
        return { ok: false, status: 401, error: 'Invalid password' };
      }
      attempts.delete(ip);
      return { ok: true, cookie: cookieValue(req, createToken()) };
    },
    verifyPassword: (password) => store.verifyAdminPassword(password),
    changePassword(password) {
      sessionVersion = store.changeAdminPassword(password);
    },
    clearCookie: () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
  };
}
