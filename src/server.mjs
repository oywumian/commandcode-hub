import http from 'node:http';
import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from './config.mjs';
import { createStore } from './db.mjs';
import { fetchQuota } from './quota.mjs';
import { createAdminAuth } from './admin-auth.mjs';
import { createUsageParser } from './usage-parser.mjs';

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const HOP_BY_HOP_HEADERS = [
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
];

function stripHopByHop(headers) {
  const clean = { ...headers };
  const connectionTokens = String(clean.connection || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  for (const name of [...HOP_BY_HOP_HEADERS, ...connectionTokens]) delete clean[name];
  return clean;
}

function json(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

function errorJson(res, status, message, type = 'request_error') {
  json(res, status, { error: { message, type } });
}

async function readBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error('Request body is too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req, maxBytes = 1024 * 1024) {
  const body = await readBody(req, maxBytes);
  if (!body.length) return {};
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON body');
    error.status = 400;
    throw error;
  }
}

function gatewayKey(req) {
  const authorization = String(req.headers.authorization || '');
  if (authorization.toLowerCase().startsWith('bearer ')) return authorization.slice(7).trim();
  return String(req.headers['x-api-key'] || '');
}

function gatewayAuthenticated(req, store) {
  const key = gatewayKey(req);
  return Boolean(key) && Boolean(store.authenticateGatewayKey(key));
}

function publicRuntime(startedAt, config, refreshing) {
  return {
    status: 'ok',
    startedAt,
    uptimeSeconds: Math.floor(process.uptime()),
    nodeVersion: process.version,
    platform: process.platform,
    gateway: `${config.host}:${config.port}`,
    internalProxy: `${config.internalHost}:${config.internalPort}`,
    quotaRefreshMs: config.quotaRefreshMs,
    refreshing,
  };
}

function validateApiKey(value) {
  const key = String(value || '').trim();
  if (!/^user_[A-Za-z0-9_-]+$/.test(key)) {
    const error = new Error('Command Code API key must start with user_');
    error.status = 400;
    throw error;
  }
  return key;
}

function apiError(res, error) {
  const status = Number(error.status) || (error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 409 : 500);
  const message = status >= 500 ? 'Internal server error' : error.message;
  if (status >= 500) console.error('[hub]', error);
  errorJson(res, status, message, status === 409 ? 'conflict' : 'admin_error');
}

function findImportedKeys(value, output = new Set()) {
  if (typeof value === 'string') {
    const matches = value.match(/user_[A-Za-z0-9_-]+/g);
    for (const key of matches || []) output.add(key);
  } else if (Array.isArray(value)) {
    for (const item of value) findImportedKeys(item, output);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) findImportedKeys(item, output);
  }
  return [...output];
}

function safeStaticPath(distDir, pathname) {
  const relative = pathname.startsWith('/admin/') ? pathname.slice('/admin/'.length) : '';
  const target = normalize(join(distDir, relative || 'index.html'));
  const root = `${normalize(distDir)}${sep}`;
  return target === normalize(distDir) || target.startsWith(root) ? target : null;
}

export function createHubApp(config, store, options = {}) {
  const auth = createAdminAuth(config, store);
  const startedAt = Date.now();
  const distDir = options.distDir || fileURLToPath(new URL('../dist', import.meta.url));
  let refreshing = false;

  async function refreshAccount(id) {
    const account = store.getAccountWithKey(id);
    if (!account) {
      const error = new Error('Account not found');
      error.status = 404;
      throw error;
    }
    try {
      const report = await fetchQuota(config, account.apiKey);
      return store.saveQuota(id, report);
    } catch (error) {
      store.saveAccountError(id, error.message);
      throw error;
    }
  }

  async function refreshAll() {
    if (refreshing) return { refreshed: 0, errors: [] };
    refreshing = true;
    let refreshed = 0;
    const errors = [];
    try {
      for (const account of store.listAccounts().filter((item) => item.enabled)) {
        try {
          await refreshAccount(account.id);
          refreshed += 1;
        } catch (error) {
          errors.push({ id: account.id, name: account.name, error: error.message });
        }
      }
      store.cleanup();
      return { refreshed, errors };
    } finally {
      refreshing = false;
    }
  }

  async function proxyRequest(req, res, url) {
    if (!gatewayAuthenticated(req, store)) {
      return errorJson(res, 401, 'Invalid gateway API key', 'authentication_error');
    }
    const account = store.getDefaultAccountWithKey();
    if (!account) {
      return errorJson(res, 503, 'No enabled default Command Code account. Select one in the admin dashboard.', 'account_unavailable');
    }

    let body;
    try {
      body = await readBody(req, config.maxBodyBytes);
    } catch (error) {
      return errorJson(res, error.status || 400, error.message, 'invalid_request_error');
    }

    let requestMeta = {};
    if (body.length && String(req.headers['content-type'] || '').includes('application/json')) {
      try {
        const parsed = JSON.parse(body.toString('utf8'));
        requestMeta = { model: String(parsed.model || ''), streaming: parsed.stream === true };
      } catch {}
    }

    const started = Date.now();
    let logged = false;
    const parser = createUsageParser();
    const finishLog = (status, errorType = '') => {
      if (logged) return;
      logged = true;
      const usage = parser.finish();
      store.addRequestLog({
        accountId: account.id,
        path: url.pathname,
        ...requestMeta,
        status,
        durationMs: Date.now() - started,
        ...usage,
        errorType: usage.errorType || errorType,
      });
    };

    const headers = stripHopByHop(req.headers);
    delete headers.host;
    delete headers['content-length'];
    headers.authorization = `Bearer ${account.apiKey}`;
    headers['x-api-key'] = account.apiKey;
    headers['content-length'] = String(body.length);

    const upstream = http.request({
      host: config.internalHost,
      port: config.internalPort,
      method: req.method,
      path: `${url.pathname}${url.search}`,
      headers,
    });

    upstream.on('response', (upstreamRes) => {
      const responseHeaders = stripHopByHop(upstreamRes.headers);
      responseHeaders['access-control-allow-origin'] = '*';
      res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
      const contentType = String(upstreamRes.headers['content-type'] || '');
      upstreamRes.on('data', (chunk) => {
        parser.push(chunk, contentType);
        if (!res.write(chunk)) upstreamRes.pause();
      });
      res.on('drain', () => upstreamRes.resume());
      upstreamRes.on('end', () => {
        res.end();
        finishLog(upstreamRes.statusCode || 502);
      });
      upstreamRes.on('error', (error) => {
        if (!res.headersSent) errorJson(res, 502, 'Internal proxy stream failed', 'proxy_error');
        else res.destroy(error);
        finishLog(upstreamRes.statusCode || 502, 'proxy_stream_error');
      });
    });

    upstream.on('error', (error) => {
      if (!res.headersSent) errorJson(res, 502, 'Internal proxy is unavailable', 'proxy_error');
      else res.destroy(error);
      finishLog(502, 'proxy_error');
    });
    res.once('close', () => {
      if (!res.writableEnded) {
        upstream.destroy();
        finishLog(499, 'client_disconnected');
      }
    });
    upstream.end(body);
  }

  async function adminApi(req, res, url) {
    if (url.pathname === '/api/admin/login' && req.method === 'POST') {
      const body = await readJson(req);
      const result = auth.login(req, String(body.password || ''));
      if (!result.ok) return errorJson(res, result.status, result.error, 'authentication_error');
      return json(res, 200, { authenticated: true }, { 'Set-Cookie': result.cookie });
    }
    if (url.pathname === '/api/admin/session' && req.method === 'GET') {
      return json(res, 200, { authenticated: auth.isAuthenticated(req) });
    }
    if (!auth.isAuthenticated(req)) return errorJson(res, 401, 'Admin login required', 'authentication_error');
    if (url.pathname === '/api/admin/logout' && req.method === 'POST') {
      return json(res, 200, { authenticated: false }, { 'Set-Cookie': auth.clearCookie() });
    }

    if (url.pathname === '/api/admin/overview' && req.method === 'GET') {
      const accounts = store.listAccounts();
      const from = Date.now() - 24 * 3600000;
      const defaultAccount = accounts.find((account) => account.isDefault) || null;
      return json(res, 200, {
        accounts,
        defaultAccount,
        requestSummary: store.requestSummary(from),
        requestSeries: store.requestSeries(from),
        quotaHistory: defaultAccount ? store.getQuotaHistory(defaultAccount.id, Date.now() - 30 * 86400000) : [],
        runtime: publicRuntime(startedAt, config, refreshing),
      });
    }
    if (url.pathname === '/api/admin/accounts' && req.method === 'GET') {
      return json(res, 200, { accounts: store.listAccounts() });
    }
    if (url.pathname === '/api/admin/accounts' && req.method === 'POST') {
      const body = await readJson(req);
      const apiKey = validateApiKey(body.apiKey);
      if (store.findByKey(apiKey)) return errorJson(res, 409, 'This API key is already registered', 'conflict');
      const report = await fetchQuota(config, apiKey);
      const name = String(body.name || report.account?.userName || report.account?.name || 'Command Code account').trim();
      return json(res, 201, { account: store.createAccount({ name, apiKey, report }) });
    }
    if (url.pathname === '/api/admin/accounts/import' && req.method === 'POST') {
      if (!existsSync(config.authFile)) return errorJson(res, 404, `Auth file not found: ${config.authFile}`, 'not_found');
      const keys = findImportedKeys(JSON.parse(readFileSync(config.authFile, 'utf8')));
      const result = { added: [], duplicates: [], errors: [] };
      for (const apiKey of keys) {
        if (store.findByKey(apiKey)) {
          result.duplicates.push(apiKey.slice(0, 8));
          continue;
        }
        try {
          const report = await fetchQuota(config, apiKey);
          const name = report.account?.userName || report.account?.name || `Imported account ${result.added.length + 1}`;
          result.added.push(store.createAccount({ name, apiKey, report }));
        } catch (error) {
          result.errors.push(error.message);
        }
      }
      return json(res, 200, result);
    }
    if (url.pathname === '/api/admin/quotas/refresh' && req.method === 'POST') {
      return json(res, 200, await refreshAll());
    }
    if (url.pathname === '/api/admin/requests' && req.method === 'GET') {
      const days = Math.min(7, Math.max(1, Number(url.searchParams.get('days')) || 1));
      const from = Date.now() - days * 86400000;
      return json(res, 200, {
        requests: store.listRequestLogs({ from, limit: Number(url.searchParams.get('limit')) || 200 }),
        summary: store.requestSummary(from),
        series: store.requestSeries(from, days > 2 ? 86400000 : 3600000),
      });
    }
    if (url.pathname === '/api/admin/runtime' && req.method === 'GET') {
      return json(res, 200, publicRuntime(startedAt, config, refreshing));
    }
    if (url.pathname === '/api/admin/security' && req.method === 'GET') {
      return json(res, 200, store.getSecuritySettings());
    }
    if (url.pathname === '/api/admin/security/password' && req.method === 'POST') {
      const body = await readJson(req);
      if (!auth.verifyPassword(String(body.currentPassword || ''))) {
        return errorJson(res, 401, 'Current password is incorrect', 'authentication_error');
      }
      const newPassword = String(body.newPassword || '');
      if (newPassword.length < 6 || newPassword.length > 256) {
        return errorJson(res, 400, 'New password must be between 6 and 256 characters', 'invalid_password');
      }
      auth.changePassword(newPassword);
      return json(res, 200, { changed: true, authenticated: false }, { 'Set-Cookie': auth.clearCookie() });
    }
    if (url.pathname === '/api/admin/security/api-keys' && req.method === 'POST') {
      const body = await readJson(req);
      const name = String(body.name || '').trim().slice(0, 60);
      if (!name) return errorJson(res, 400, 'API key name is required', 'invalid_api_key');
      const apiKey = `sk-${crypto.randomBytes(32).toString('hex')}`;
      return json(res, 201, { apiKey, key: store.createGatewayKey(name, apiKey) });
    }
    const gatewayKeyMatch = url.pathname.match(/^\/api\/admin\/security\/api-keys\/([^/]+)$/);
    if (gatewayKeyMatch && req.method === 'PUT') {
      const key = store.updateGatewayKey(gatewayKeyMatch[1], await readJson(req));
      if (!key) return errorJson(res, 404, 'API key not found', 'not_found');
      return json(res, 200, { key });
    }
    if (gatewayKeyMatch && req.method === 'DELETE') {
      if (!store.deleteGatewayKey(gatewayKeyMatch[1])) return errorJson(res, 404, 'API key not found', 'not_found');
      return json(res, 200, { deleted: true });
    }

    const accountMatch = url.pathname.match(/^\/api\/admin\/accounts\/([^/]+)(?:\/(default|refresh|quota-history))?$/);
    if (accountMatch) {
      const [, id, action] = accountMatch;
      if (!action && req.method === 'PUT') {
        const body = await readJson(req);
        if (body.apiKey) validateApiKey(body.apiKey);
        const account = store.updateAccount(id, body);
        if (!account) return errorJson(res, 404, 'Account not found', 'not_found');
        return json(res, 200, { account });
      }
      if (!action && req.method === 'DELETE') {
        if (!store.deleteAccount(id)) return errorJson(res, 404, 'Account not found', 'not_found');
        return json(res, 200, { deleted: true });
      }
      if (action === 'default' && req.method === 'POST') {
        const account = store.setDefault(id);
        if (!account) return errorJson(res, 400, 'Account must exist and be enabled', 'invalid_account');
        return json(res, 200, { account });
      }
      if (action === 'refresh' && req.method === 'POST') {
        return json(res, 200, { account: await refreshAccount(id) });
      }
      if (action === 'quota-history' && req.method === 'GET') {
        const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 30));
        return json(res, 200, { history: store.getQuotaHistory(id, Date.now() - days * 86400000) });
      }
    }
    return errorJson(res, 404, 'Admin endpoint not found', 'not_found');
  }

  async function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      });
      return res.end();
    }
    try {
      if (url.pathname === '/health') return json(res, 200, { status: 'ok', defaultAccount: Boolean(store.getDefaultAccountWithKey()) });
      if (url.pathname.startsWith('/v1/')) return await proxyRequest(req, res, url);
      if (url.pathname.startsWith('/api/admin/')) return await adminApi(req, res, url);
      if (url.pathname === '/') {
        res.writeHead(302, { Location: '/admin/' });
        return res.end();
      }
      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
        let target = safeStaticPath(distDir, url.pathname === '/admin' ? '/admin/' : url.pathname);
        if (!target || !existsSync(target)) target = join(distDir, 'index.html');
        if (!existsSync(target)) return errorJson(res, 503, 'Dashboard has not been built. Run npm run build.', 'dashboard_unavailable');
        const content = readFileSync(target);
        res.writeHead(200, {
          'Content-Type': MIME[extname(target)] || 'application/octet-stream',
          'Content-Length': content.length,
          'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
        });
        return res.end(content);
      }
      return errorJson(res, 404, 'Not found', 'not_found');
    } catch (error) {
      return apiError(res, error);
    }
  }

  return { handler, refreshAll, isRefreshing: () => refreshing };
}

async function waitForInternal(config) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${config.internalHost}:${config.internalPort}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Internal Command Code proxy did not start');
}

export async function startHub(config = loadConfig()) {
  process.env.PORT = String(config.internalPort);
  process.env.HOST = config.internalHost;
  process.env.CC_API_BASE = config.apiBase;
  process.env.CC_MAX_BODY_MB ??= String(Math.floor(config.maxBodyBytes / 1024 / 1024));
  process.env.CC_MAX_INFLIGHT ??= String(config.maxInflight);
  process.env.CC_STREAM_IDLE_MS ??= String(config.streamIdleMs);
  process.env.CC_NONSTREAM_IDLE_MS ??= String(config.nonstreamIdleMs);
  await import('../proxy.mjs');
  await waitForInternal(config);

  const store = createStore(config);
  const app = createHubApp(config, store);
  const server = http.createServer(app.handler);
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });

  const quotaTimer = setInterval(() => app.refreshAll().catch((error) => console.error('[quota]', error)), config.quotaRefreshMs);
  quotaTimer.unref();
  setTimeout(() => app.refreshAll().catch((error) => console.error('[quota]', error)), 2000).unref();
  const stop = () => {
    clearInterval(quotaTimer);
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  console.log(`[hub] listening on http://${config.host}:${config.port}`);
  return { server, store, app };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startHub().catch((error) => {
    console.error('[hub] startup failed:', error);
    process.exit(1);
  });
}
