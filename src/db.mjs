import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { decryptSecret, encryptSecret, hashPassword, hashSecret, maskSecret, verifyPassword } from './secrets.mjs';

export function createStore(config) {
  mkdirSync(config.dataDir, { recursive: true });
  const db = new Database(join(config.dataDir, 'hub.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_key_enc TEXT NOT NULL,
      api_key_hash TEXT NOT NULL UNIQUE,
      api_key_masked TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      user_id TEXT NOT NULL DEFAULT '',
      user_name TEXT NOT NULL DEFAULT '',
      plan_id TEXT NOT NULL DEFAULT '',
      plan_name TEXT NOT NULL DEFAULT '',
      latest_quota_json TEXT,
      latest_raw_json TEXT,
      last_quota_at INTEGER,
      last_success_at INTEGER,
      last_error TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_default_account ON accounts(is_default) WHERE is_default = 1;
    CREATE TABLE IF NOT EXISTS quota_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      captured_at INTEGER NOT NULL,
      five_used REAL,
      five_cap REAL,
      five_reset_at INTEGER,
      weekly_used REAL,
      weekly_cap REAL,
      weekly_reset_at INTEGER,
      monthly_remaining REAL,
      monthly_cap REAL,
      purchased_credits REAL,
      free_credits REAL,
      total_tokens_in REAL,
      total_tokens_out REAL,
      total_credits REAL
    );
    CREATE INDEX IF NOT EXISTS quota_snapshots_account_time ON quota_snapshots(account_id, captured_at);
    CREATE TABLE IF NOT EXISTS request_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      path TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      streaming INTEGER NOT NULL DEFAULT 0,
      status INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cached_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      error_type TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS request_logs_time ON request_logs(created_at);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gateway_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_masked TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS gateway_keys_enabled ON gateway_keys(enabled);
  `);

  const getSettingRow = (key) => db.prepare('SELECT value, updated_at FROM settings WHERE key = ?').get(key);
  const setSetting = (key, value) => db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).run(key, value, Date.now());
  db.transaction(() => {
    if (!getSettingRow('admin_password_hash')) setSetting('admin_password_hash', hashPassword(config.adminPassword));
    if (!getSettingRow('session_version')) setSetting('session_version', '1');
    if (db.prepare('SELECT COUNT(*) AS count FROM gateway_keys').get().count === 0) {
      const legacy = getSettingRow('gateway_api_key');
      const apiKey = legacy ? decryptSecret(legacy.value, config.masterKey) : config.gatewayApiKey;
      const now = Date.now();
      db.prepare(`INSERT INTO gateway_keys (id, name, key_hash, key_masked, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)`).run(crypto.randomUUID(), 'Bootstrap key', hashSecret(apiKey), maskSecret(apiKey), now, now);
      if (legacy) db.prepare("DELETE FROM settings WHERE key = 'gateway_api_key'").run();
    }
  })();

  const publicGatewayKey = (row) => row && ({
    id: row.id,
    name: row.name,
    maskedKey: row.key_masked,
    enabled: Boolean(row.enabled),
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const publicAccount = (row) => row && ({
    id: row.id,
    name: row.name,
    maskedKey: row.api_key_masked,
    enabled: Boolean(row.enabled),
    isDefault: Boolean(row.is_default),
    userId: row.user_id,
    userName: row.user_name,
    planId: row.plan_id,
    planName: row.plan_name,
    quota: row.latest_quota_json ? JSON.parse(row.latest_quota_json) : null,
    lastQuotaAt: row.last_quota_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  function getRawAccount(id) {
    return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  }

  function accountWithKey(row) {
    return row && { ...publicAccount(row), apiKey: decryptSecret(row.api_key_enc, config.masterKey) };
  }

  const createAccountTx = db.transaction(({ name, apiKey, report }) => {
    const now = Date.now();
    const id = crypto.randomUUID();
    const count = db.prepare('SELECT COUNT(*) AS count FROM accounts').get().count;
    const isDefault = count === 0 ? 1 : 0;
    db.prepare(`INSERT INTO accounts
      (id, name, api_key_enc, api_key_hash, api_key_masked, enabled, is_default, user_id, user_name, plan_id, plan_name,
       latest_quota_json, latest_raw_json, last_quota_at, last_success_at, last_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`)
      .run(id, name.trim(), encryptSecret(apiKey, config.masterKey), hashSecret(apiKey), maskSecret(apiKey), isDefault,
        report.account?.id || '', report.account?.userName || report.account?.name || '', report.plan?.planId || '', report.plan?.name || '',
        JSON.stringify(report.normalized), JSON.stringify(report.raw), report.fetchedAt, now, now, now);
    insertQuotaSnapshot(id, report);
    return publicAccount(getRawAccount(id));
  });

  function insertQuotaSnapshot(accountId, report) {
    const q = report.normalized;
    db.prepare(`INSERT INTO quota_snapshots
      (account_id, captured_at, five_used, five_cap, five_reset_at, weekly_used, weekly_cap, weekly_reset_at,
       monthly_remaining, monthly_cap, purchased_credits, free_credits, total_tokens_in, total_tokens_out, total_credits)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(accountId, report.fetchedAt,
        q.credits?.fiveHour?.used ?? null, q.credits?.fiveHour?.cap ?? null, q.credits?.fiveHour?.resetAt ?? null,
        q.credits?.weekly?.used ?? null, q.credits?.weekly?.cap ?? null, q.credits?.weekly?.resetAt ?? null,
        q.credits?.monthlyCredits ?? null, q.monthly?.cap ?? null, q.credits?.purchasedCredits ?? null,
        q.credits?.freeCredits ?? null, q.usage?.totalTokensIn ?? null, q.usage?.totalTokensOut ?? null,
        q.usage?.totalCredits ?? null);
  }

  return {
    db,
    listAccounts: () => db.prepare('SELECT * FROM accounts ORDER BY is_default DESC, name COLLATE NOCASE').all().map(publicAccount),
    getAccount: (id) => publicAccount(getRawAccount(id)),
    getAccountWithKey: (id) => accountWithKey(getRawAccount(id)),
    getDefaultAccountWithKey: () => accountWithKey(db.prepare('SELECT * FROM accounts WHERE enabled = 1 AND is_default = 1').get()),
    findByKey: (apiKey) => publicAccount(db.prepare('SELECT * FROM accounts WHERE api_key_hash = ?').get(hashSecret(apiKey))),
    createAccount: createAccountTx,
    updateAccount(id, changes) {
      const existing = getRawAccount(id);
      if (!existing) return null;
      const next = {
        name: changes.name?.trim() || existing.name,
        enabled: changes.enabled === undefined ? existing.enabled : Number(Boolean(changes.enabled)),
        apiKeyEnc: existing.api_key_enc,
        apiKeyHash: existing.api_key_hash,
        apiKeyMasked: existing.api_key_masked,
      };
      if (changes.apiKey) {
        next.apiKeyEnc = encryptSecret(changes.apiKey, config.masterKey);
        next.apiKeyHash = hashSecret(changes.apiKey);
        next.apiKeyMasked = maskSecret(changes.apiKey);
      }
      db.transaction(() => {
        const now = Date.now();
        db.prepare(`UPDATE accounts SET name=?, enabled=?, api_key_enc=?, api_key_hash=?, api_key_masked=?, updated_at=? WHERE id=?`)
          .run(next.name, next.enabled, next.apiKeyEnc, next.apiKeyHash, next.apiKeyMasked, now, id);
        if (existing.is_default && !next.enabled) {
          db.prepare('UPDATE accounts SET is_default = 0 WHERE id = ?').run(id);
          const replacement = db.prepare('SELECT id FROM accounts WHERE enabled = 1 AND id != ? ORDER BY created_at LIMIT 1').get(id);
          if (replacement) db.prepare('UPDATE accounts SET is_default = 1, updated_at = ? WHERE id = ?').run(now, replacement.id);
        }
      })();
      return publicAccount(getRawAccount(id));
    },
    deleteAccount(id) {
      const row = getRawAccount(id);
      if (!row) return false;
      const tx = db.transaction(() => {
        db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
        if (row.is_default) {
          const replacement = db.prepare('SELECT id FROM accounts WHERE enabled = 1 ORDER BY created_at LIMIT 1').get();
          if (replacement) db.prepare('UPDATE accounts SET is_default = 1, updated_at = ? WHERE id = ?').run(Date.now(), replacement.id);
        }
      });
      tx();
      return true;
    },
    setDefault(id) {
      const row = getRawAccount(id);
      if (!row || !row.enabled) return null;
      db.transaction(() => {
        db.prepare('UPDATE accounts SET is_default = 0').run();
        db.prepare('UPDATE accounts SET is_default = 1, updated_at = ? WHERE id = ?').run(Date.now(), id);
      })();
      return publicAccount(getRawAccount(id));
    },
    saveQuota(id, report) {
      const now = Date.now();
      db.transaction(() => {
        db.prepare(`UPDATE accounts SET user_id=?, user_name=?, plan_id=?, plan_name=?, latest_quota_json=?, latest_raw_json=?,
          last_quota_at=?, last_success_at=?, last_error='', updated_at=? WHERE id=?`)
          .run(report.account?.id || '', report.account?.userName || report.account?.name || '', report.plan?.planId || '', report.plan?.name || '',
            JSON.stringify(report.normalized), JSON.stringify(report.raw), report.fetchedAt, now, now, id);
        insertQuotaSnapshot(id, report);
      })();
      return publicAccount(getRawAccount(id));
    },
    saveAccountError(id, error) {
      db.prepare('UPDATE accounts SET last_error=?, last_quota_at=?, updated_at=? WHERE id=?')
        .run(String(error).slice(0, 500), Date.now(), Date.now(), id);
    },
    getQuotaHistory(accountId, from) {
      return db.prepare('SELECT * FROM quota_snapshots WHERE account_id = ? AND captured_at >= ? ORDER BY captured_at')
        .all(accountId, from);
    },
    addRequestLog(log) {
      db.prepare(`INSERT INTO request_logs
        (account_id,path,model,streaming,status,duration_ms,input_tokens,output_tokens,cached_tokens,reasoning_tokens,error_type,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(log.accountId, log.path, log.model || '', Number(Boolean(log.streaming)), log.status,
          log.durationMs, log.inputTokens || 0, log.outputTokens || 0, log.cachedTokens || 0, log.reasoningTokens || 0,
          log.errorType || '', log.createdAt || Date.now());
    },
    listRequestLogs({ limit = 100, from = 0 } = {}) {
      return db.prepare(`SELECT r.*, a.name AS account_name FROM request_logs r LEFT JOIN accounts a ON a.id=r.account_id
        WHERE r.created_at >= ? ORDER BY r.created_at DESC LIMIT ?`).all(from, Math.min(500, limit));
    },
    requestSummary(from) {
      return db.prepare(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN status BETWEEN 200 AND 399 THEN 1 ELSE 0 END) AS successful,
        COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens,
        COALESCE(SUM(cached_tokens),0) AS cached_tokens, COALESCE(AVG(duration_ms),0) AS avg_duration_ms
        FROM request_logs WHERE created_at >= ?`).get(from);
    },
    requestSeries(from, bucketMs = 3600000) {
      return db.prepare(`SELECT CAST(created_at / ? AS INTEGER) * ? AS time,
        COUNT(*) AS total,
        SUM(CASE WHEN status BETWEEN 200 AND 399 THEN 1 ELSE 0 END) AS successful,
        COALESCE(SUM(input_tokens),0) AS input_tokens,
        COALESCE(SUM(output_tokens),0) AS output_tokens,
        COALESCE(AVG(duration_ms),0) AS avg_duration_ms
        FROM request_logs WHERE created_at >= ? GROUP BY CAST(created_at / ? AS INTEGER) ORDER BY time`)
        .all(bucketMs, bucketMs, from, bucketMs);
    },
    verifyAdminPassword(password) {
      return verifyPassword(password, getSettingRow('admin_password_hash')?.value);
    },
    changeAdminPassword(password) {
      return db.transaction(() => {
        setSetting('admin_password_hash', hashPassword(password));
        const version = Number.parseInt(getSettingRow('session_version')?.value || '1', 10) + 1;
        setSetting('session_version', String(version));
        return version;
      })();
    },
    getSessionVersion: () => Number.parseInt(getSettingRow('session_version')?.value || '1', 10),
    authenticateGatewayKey(apiKey) {
      const row = db.prepare('SELECT * FROM gateway_keys WHERE key_hash = ? AND enabled = 1').get(hashSecret(apiKey));
      if (!row) return null;
      const now = Date.now();
      if (!row.last_used_at || row.last_used_at < now - 60000) {
        db.prepare('UPDATE gateway_keys SET last_used_at = ? WHERE id = ?').run(now, row.id);
        row.last_used_at = now;
      }
      return publicGatewayKey(row);
    },
    listGatewayKeys: () => db.prepare('SELECT * FROM gateway_keys ORDER BY created_at DESC').all().map(publicGatewayKey),
    createGatewayKey(name, apiKey) {
      const now = Date.now();
      const id = crypto.randomUUID();
      db.prepare(`INSERT INTO gateway_keys (id, name, key_hash, key_masked, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)`).run(id, name, hashSecret(apiKey), maskSecret(apiKey), now, now);
      return publicGatewayKey(db.prepare('SELECT * FROM gateway_keys WHERE id = ?').get(id));
    },
    updateGatewayKey(id, changes) {
      const row = db.prepare('SELECT * FROM gateway_keys WHERE id = ?').get(id);
      if (!row) return null;
      const enabled = changes.enabled === undefined ? row.enabled : Number(Boolean(changes.enabled));
      if (!enabled && row.enabled && db.prepare('SELECT COUNT(*) AS count FROM gateway_keys WHERE enabled = 1').get().count <= 1) {
        const error = new Error('At least one API key must remain enabled');
        error.status = 400;
        throw error;
      }
      const name = String(changes.name || row.name).trim().slice(0, 60) || row.name;
      db.prepare('UPDATE gateway_keys SET name = ?, enabled = ?, updated_at = ? WHERE id = ?').run(name, enabled, Date.now(), id);
      return publicGatewayKey(db.prepare('SELECT * FROM gateway_keys WHERE id = ?').get(id));
    },
    deleteGatewayKey(id) {
      const row = db.prepare('SELECT * FROM gateway_keys WHERE id = ?').get(id);
      if (!row) return false;
      if (row.enabled && db.prepare('SELECT COUNT(*) AS count FROM gateway_keys WHERE enabled = 1').get().count <= 1) {
        const error = new Error('At least one API key must remain enabled');
        error.status = 400;
        throw error;
      }
      db.prepare('DELETE FROM gateway_keys WHERE id = ?').run(id);
      return true;
    },
    getSecuritySettings() {
      return {
        apiKeys: db.prepare('SELECT * FROM gateway_keys ORDER BY created_at DESC').all().map(publicGatewayKey),
        passwordUpdatedAt: getSettingRow('admin_password_hash')?.updated_at || null,
      };
    },
    cleanup() {
      const now = Date.now();
      db.prepare('DELETE FROM quota_snapshots WHERE captured_at < ?').run(now - config.quotaRetentionDays * 86400000);
      db.prepare('DELETE FROM request_logs WHERE created_at < ?').run(now - config.requestRetentionDays * 86400000);
    },
    close: () => db.close(),
  };
}
