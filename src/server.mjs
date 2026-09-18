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
import { createModelTester } from './model-tester.mjs';
import { estimateUsageCredits, getGoPlanPricing, GO_PLAN_PRICING_META } from './model-pricing.mjs';
import { publicModelId } from '../model-catalog.mjs';

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

function accountQuotaScore(account) {
  const credits = account.quota?.credits || {};
  const windows = [credits.fiveHour, credits.weekly];
  if (windows.some((window) => window?.exceeded)) return 10;
  const ratios = windows.map((window) => {
    if (!window || window.cap <= 0 || window.used === null || window.used === undefined) return null;
    return Math.min(1, window.used / window.cap);
  }).filter((value) => value !== null);
  return ratios.length ? Math.max(...ratios) : 0.5;
}

function selectAccount(accounts, mode, modelId, isModelEnabled = () => true) {
  const eligible = accounts.filter((account) => !modelId || isModelEnabled(account.id, modelId));
  if (!eligible.length) return accounts[0] || null;
  if (mode !== 'auto') return eligible.find((account) => account.isDefault) || eligible[0];
  return [...eligible].sort((a, b) => {
    const score = accountQuotaScore(a) - accountQuotaScore(b);
    if (score) return score;
    const error = Number(Boolean(a.lastError)) - Number(Boolean(b.lastError));
    if (error) return error;
    return Number(b.isDefault) - Number(a.isDefault);
  })[0];
}

function normalizeClient(value = '') {
  const text = String(value).trim().slice(0, 80);
  const lower = text.toLowerCase();
  if (!text) return '未知客户端';
  if (lower.includes('codex')) return 'Codex';
  if (lower.includes('opencode')) return 'OpenCode';
  if (lower.includes('claude')) return 'Claude Code';
  if (lower.includes('openai-python') || lower.includes('openai/')) return 'OpenAI SDK';
  if (lower.startsWith('curl')) return 'curl';
  return text;
}

function requestTools(value) {
  const tools = value.tools || value.params?.tools || value.input?.tools || [];
  if (!Array.isArray(tools)) return { count: 0, names: [] };
  const names = tools
    .map((tool) => tool?.function?.name || tool?.name || tool?.type)
    .filter(Boolean)
    .map((name) => String(name).slice(0, 80));
  return { count: names.length, names: [...new Set(names)] };
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
  const modelTester = createModelTester({ config, store });
  let refreshing = false;

  async function getAccountModelCatalog(account) {
    let response;
    try {
      response = await fetch(`http://${config.internalHost}:${config.internalPort}/v1/models`, {
        headers: {
          authorization: `Bearer ${account.apiKey}`,
          'x-api-key': account.apiKey,
        },
        signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      const wrapped = new Error(`Model catalog request failed: ${error.message}`);
      wrapped.status = 502;
      throw wrapped;
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error?.message || 'Model catalog request failed');
      error.status = response.status;
      throw error;
    }

    const states = new Map((store.listAccountModelStates?.(account.id) || []).map((state) => [state.modelId, state]));
    const models = (Array.isArray(payload.data) ? payload.data : []).map((model) => {
      const id = publicModelId(model.id);
      const state = states.get(id);
      return {
        ...model,
        id,
        pricing: getGoPlanPricing(id),
        enabled: state?.enabled ?? true,
        status: state?.status || 'untested',
        error: state?.error || '',
        testedAt: state?.testedAt ?? null,
      };
    });
    return models;
  }

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
    let body;
    try {
      body = await readBody(req, config.maxBodyBytes);
    } catch (error) {
      return errorJson(res, error.status || 400, error.message, 'invalid_request_error');
    }

    let requestMeta = { client: normalizeClient(req.headers['user-agent']) };
    if (body.length && String(req.headers['content-type'] || '').includes('application/json')) {
      try {
        const parsed = JSON.parse(body.toString('utf8'));
        const tools = requestTools(parsed);
        requestMeta = {
          ...requestMeta,
          client: normalizeClient(parsed.metadata?.user_agent || parsed.user_agent || parsed.user || req.headers['user-agent']),
          model: String(parsed.model || ''),
          streaming: parsed.stream === true,
          toolCount: tools.count,
          toolNames: tools.names,
        };
      } catch {}
    }

    const routingMode = store.getRoutingMode?.() || 'default';
    const accounts = store.listEnabledAccountsWithKey?.() || [store.getDefaultAccountWithKey?.()].filter(Boolean);
    const requestedModel = publicModelId(requestMeta.model);
    const account = selectAccount(accounts, routingMode, requestedModel, (accountId, modelId) =>
      typeof store.isAccountModelEnabled !== 'function' || store.isAccountModelEnabled(accountId, modelId));
    if (!account) {
      return errorJson(res, 503, routingMode === 'auto'
        ? 'No enabled account is available for this model'
        : 'No enabled default Command Code account. Select one in the admin dashboard.', 'account_unavailable');
    }

    if (url.pathname === '/v1/models' && req.method === 'GET') {
      try {
        const catalogs = routingMode === 'auto'
          ? await Promise.all(accounts.map((candidate) => getAccountModelCatalog(candidate)))
          : [await getAccountModelCatalog(account)];
        const byId = new Map();
        for (const catalog of catalogs) {
          for (const model of catalog) {
            const existing = byId.get(model.id);
            if (!existing || (!existing.enabled && model.enabled)) byId.set(model.id, model);
          }
        }
        const data = [...byId.values()].filter((model) => model.enabled).map((model) => ({
          id: model.id,
          object: model.object || 'model',
          created: model.created,
          owned_by: model.owned_by || 'command-code',
        }));
        return json(res, 200, { object: 'list', data });
      } catch (error) {
        return errorJson(res, error.status || 502, error.message, 'upstream_error');
      }
    }

    if (requestedModel && typeof store.isAccountModelEnabled === 'function' && !store.isAccountModelEnabled(account.id, requestedModel)) {
      return errorJson(res, 400, `Model "${requestedModel}" is disabled for this account`, 'model_not_available');
    }

    const started = Date.now();
    let logged = false;
    let firstByte = false;
    const parser = createUsageParser();
    const requestId = crypto.randomUUID();
    const eventBase = { requestId, accountId: account.id, ...requestMeta };
    const emitEvent = (event, message, extra = {}) => {
      try {
        store.addTerminalEvent({ ...eventBase, event, message, ...extra });
      } catch (error) {
        console.error('[terminal]', error);
      }
    };
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

    emitEvent('received', '请求已接收', { status: null });

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
      emitEvent('upstream', '上游已建立连接', {
        status: upstreamRes.statusCode || 502,
        durationMs: Date.now() - started,
        detail: contentType || '未知响应类型',
      });
      upstreamRes.on('data', (chunk) => {
        if (!firstByte) {
          firstByte = true;
          emitEvent('first_byte', '收到首个响应数据', {
            status: upstreamRes.statusCode || 502,
            ttftMs: Date.now() - started,
            detail: contentType.includes('text/event-stream') ? 'SSE 流式传输' : '非流式响应',
          });
        }
        parser.push(chunk, contentType);
        if (!res.write(chunk)) upstreamRes.pause();
      });
      res.on('drain', () => upstreamRes.resume());
      upstreamRes.on('end', () => {
        res.end();
        const status = upstreamRes.statusCode || 502;
        finishLog(status);
        const usage = parser.finish();
        const toolNames = [...new Set([...(requestMeta.toolNames || []), ...(usage.toolNames || [])])];
        const toolCount = Math.max(requestMeta.toolCount || 0, usage.toolCalls || 0);
        emitEvent('completed', '请求处理完成', {
          status,
          durationMs: Date.now() - started,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cachedTokens: usage.cachedTokens,
          reasoningTokens: usage.reasoningTokens,
          toolCount,
          toolNames,
          detail: usage.stopReason || (toolCount ? `${toolCount} 次工具调用：${toolNames.slice(0, 3).join(', ')}` : ''),
        });
      });
      upstreamRes.on('error', (error) => {
        if (!res.headersSent) errorJson(res, 502, 'Internal proxy stream failed', 'proxy_error');
        else res.destroy(error);
        emitEvent('error', '上游流传输失败', { level: 'error', status: upstreamRes.statusCode || 502, errorType: 'proxy_stream_error' });
        finishLog(upstreamRes.statusCode || 502, 'proxy_stream_error');
      });
    });

    upstream.on('error', (error) => {
      if (!res.headersSent) errorJson(res, 502, 'Internal proxy is unavailable', 'proxy_error');
      else res.destroy(error);
      emitEvent('error', '内部代理不可用', { level: 'error', status: 502, errorType: 'proxy_error' });
      finishLog(502, 'proxy_error');
    });
    res.once('close', () => {
      if (!res.writableEnded) {
        upstream.destroy();
        emitEvent('error', '客户端提前断开', { level: 'warn', status: 499, errorType: 'client_disconnected' });
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
        routingMode: store.getRoutingMode?.() || 'default',
      });
    }
    if (url.pathname === '/api/admin/accounts' && req.method === 'GET') {
      return json(res, 200, { accounts: store.listAccounts() });
    }
    if (url.pathname === '/api/admin/routing' && req.method === 'GET') {
      return json(res, 200, { mode: store.getRoutingMode?.() || 'default' });
    }
    if (url.pathname === '/api/admin/routing' && req.method === 'PUT') {
      const body = await readJson(req);
      const mode = String(body.mode || 'default');
      if (!['default', 'auto'].includes(mode)) return errorJson(res, 400, 'Routing mode must be default or auto', 'invalid_routing_mode');
      return json(res, 200, { mode: store.setRoutingMode(mode) });
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
    if (url.pathname === '/api/admin/terminal' && req.method === 'GET') {
      const days = Math.min(7, Math.max(1, Number(url.searchParams.get('days')) || 1));
      const from = Date.now() - days * 86400000;
      return json(res, 200, {
        events: store.listTerminalEvents({ from, limit: Math.min(500, Number(url.searchParams.get('limit')) || 200) }),
        stats: store.terminalStats(from),
      });
    }
    if (url.pathname === '/api/admin/terminal/clear' && req.method === 'POST') {
      store.clearTerminalEvents();
      return json(res, 200, { cleared: true });
    }
    if (url.pathname === '/api/admin/models/test' && req.method === 'GET') {
      const accountId = url.searchParams.get('accountId');
      if (!accountId) return errorJson(res, 400, 'accountId is required', 'invalid_request_error');
      if (!store.getAccount(accountId)) return errorJson(res, 404, 'Account not found', 'not_found');
      return json(res, 200, { job: modelTester.get(accountId) });
    }
    if (url.pathname === '/api/admin/models/test' && req.method === 'POST') {
      const body = await readJson(req);
      const account = body.accountId ? store.getAccountWithKey(String(body.accountId)) : null;
      if (!account) return errorJson(res, 404, 'Account not found', 'not_found');
      return json(res, 202, { job: modelTester.start(account) });
    }
    if (url.pathname === '/api/admin/models' && req.method === 'GET') {
      const accountId = url.searchParams.get('accountId');
      const account = accountId ? store.getAccountWithKey(accountId) : store.getDefaultAccountWithKey();
      if (!account) {
        return accountId
          ? errorJson(res, 404, 'Account not found', 'not_found')
          : errorJson(res, 503, 'No enabled default Command Code account', 'account_unavailable');
      }
      try {
        const models = await getAccountModelCatalog(account);
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);
        const usage = store.modelUsageToday?.(account.id, dayStart.getTime()) || { requests: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, totalTokens: 0, models: [] };
        let estimatedCredits = 0;
        let hasEstimatedCredits = false;
        usage.models = usage.models.map((item) => {
          const model = models.find((candidate) => candidate.id === item.modelId);
          const value = estimateUsageCredits(item, model?.pricing);
          if (value !== null) {
            estimatedCredits += value;
            hasEstimatedCredits = true;
          }
          return { ...item, estimatedCredits: value };
        });
        usage.estimatedCredits = hasEstimatedCredits ? estimatedCredits : null;
        usage.credits = store.confirmedCreditsUsedToday?.(account.id, dayStart.getTime()) || { value: null, status: 'unavailable', from: null, at: null };
        return json(res, 200, {
          account: { id: account.id, name: account.name, enabled: account.enabled, isDefault: account.isDefault, planId: account.planId || '', planName: account.planName || '' },
          pricingMeta: GO_PLAN_PRICING_META,
          models,
          usage,
        });
      } catch (error) {
        return errorJson(res, error.status || 502, error.message, 'upstream_error');
      }
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
