import { resolve } from 'node:path';

function positiveInt(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeInt(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function loadConfig() {
  const production = process.env.NODE_ENV === 'production';
  const config = {
    production,
    host: process.env.HUB_HOST || '127.0.0.1',
    port: positiveInt('HUB_PORT', 3050),
    internalHost: '127.0.0.1',
    internalPort: positiveInt('INTERNAL_PROXY_PORT', 3051),
    apiBase: process.env.CC_API_BASE || 'https://api.commandcode.ai',
    dataDir: resolve(process.env.HUB_DATA_DIR || 'data'),
    gatewayApiKey: process.env.GATEWAY_API_KEY || (production ? '' : 'local-proxy'),
    adminPassword: process.env.ADMIN_PASSWORD || (production ? '' : 'admin'),
    masterKey: process.env.MASTER_KEY || (production ? '' : 'development-master-key-change-me'),
    sessionSecret: process.env.SESSION_SECRET || process.env.MASTER_KEY || 'development-session-key',
    quotaRefreshMs: positiveInt('QUOTA_REFRESH_MS', 5 * 60 * 1000),
    quotaRetentionDays: positiveInt('QUOTA_RETENTION_DAYS', 90),
    requestRetentionDays: positiveInt('REQUEST_RETENTION_DAYS', 7),
    maxBodyBytes: positiveInt('CC_MAX_BODY_MB', 8) * 1024 * 1024,
    maxInflight: nonNegativeInt('CC_MAX_INFLIGHT', 4),
    streamIdleMs: nonNegativeInt('CC_STREAM_IDLE_MS', 180000),
    nonstreamIdleMs: nonNegativeInt('CC_NONSTREAM_IDLE_MS', 180000),
    authFile: resolve(process.env.COMMAND_CODE_AUTH_FILE || `${process.env.HOME || process.env.USERPROFILE || ''}/.commandcode/auth.json`),
    upstreamCliVersion: process.env.UPSTREAM_CLI_VERSION || '1.56.0',
  };

  if (production) {
    const missing = [
      ['GATEWAY_API_KEY', config.gatewayApiKey],
      ['ADMIN_PASSWORD', config.adminPassword],
      ['MASTER_KEY', config.masterKey],
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (config.port === config.internalPort) {
    throw new Error('HUB_PORT and INTERNAL_PROXY_PORT must be different');
  }
  return config;
}
