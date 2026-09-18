import { publicModelId } from '../model-catalog.mjs';

const PERMISSION_DENIED = /MODEL_NOT_IN_PLAN|not available for this|available in .+ and above plans|plan.*does not include|permission denied|forbidden/i;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 30_000;

function errorMessage(payload, text) {
  return String(payload?.error?.message || payload?.message || text || '').trim().slice(0, 500);
}

function classifyResult(status, payload, text) {
  const message = errorMessage(payload, text);

  if (status >= 200 && status < 300) {
    return { status: 'available', enabled: true, error: '' };
  }
  if (PERMISSION_DENIED.test(message) || status === 401 || status === 403 || status === 404) {
    return { status: 'unavailable', enabled: false, error: message || `HTTP ${status}` };
  }
  if (status === 400) {
    return { status: 'available', enabled: true, error: '' };
  }
  return {
    status: 'unknown',
    enabled: true,
    error: message || `HTTP ${status}`,
  };
}

async function runWithConcurrency(items, concurrency, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

export function createModelTester({ config, store, logger = console }) {
  const jobs = new Map();

  function publicJob(job) {
    if (!job) return { status: 'idle' };
    return {
      accountId: job.accountId,
      status: job.status,
      total: job.total,
      completed: job.completed,
      available: job.available,
      unavailable: job.unavailable,
      unknown: job.unknown,
      current: job.current,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      error: job.error,
    };
  }

  async function loadModels(account) {
    const response = await fetch(`http://${config.internalHost}:${config.internalPort}/v1/models`, {
      headers: {
        authorization: `Bearer ${account.apiKey}`,
        'x-api-key': account.apiKey,
      },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    const payload = (() => {
      try { return JSON.parse(text); } catch { return {}; }
    })();
    if (!response.ok) throw new Error(errorMessage(payload, text) || `模型目录读取失败（HTTP ${response.status}）`);
    return (Array.isArray(payload.data) ? payload.data : []).map((model) => ({
      ...model,
      id: publicModelId(model?.id),
    }));
  }

  async function testModel(account, model, timeoutMs) {
    const response = await fetch(`http://${config.internalHost}:${config.internalPort}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${account.apiKey}`,
        'x-api-key': account.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: 'user', content: 'Reply OK.' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    const payload = (() => {
      try { return JSON.parse(text); } catch { return {}; }
    })();
    return classifyResult(response.status, payload, text);
  }

  async function run(account, job) {
    try {
      const models = (await loadModels(account)).filter((model) => model && String(model.id || '').trim());
      job.total = models.length;
      job.current = '';

      await runWithConcurrency(models, DEFAULT_CONCURRENCY, async (model) => {
        const modelId = String(model.id).trim();
        job.current = modelId;
        let result;
        try {
          result = await testModel(account, model, DEFAULT_TIMEOUT_MS);
        } catch (error) {
          result = {
            status: 'unknown',
            enabled: true,
            error: error.name === 'TimeoutError' ? '检测超时' : String(error.message || error),
          };
        }

        const saved = {
          modelId,
          enabled: result.enabled,
          status: result.status,
          error: result.error,
          testedAt: Date.now(),
        };
        store.saveAccountModelTest(account.id, saved);
        job.completed += 1;
        job[result.status] += 1;
      });

      job.status = 'completed';
      job.current = '';
      job.finishedAt = Date.now();
    } catch (error) {
      job.status = 'failed';
      job.current = '';
      job.error = String(error.message || error);
      job.finishedAt = Date.now();
      logger.error?.('[models] account model test failed', { accountId: account.id, error: job.error });
    }
  }

  return {
    start(account) {
      const current = jobs.get(account.id);
      if (current?.status === 'running') return publicJob(current);

      const job = {
        accountId: account.id,
        status: 'running',
        total: 0,
        completed: 0,
        available: 0,
        unavailable: 0,
        unknown: 0,
        current: '',
        startedAt: Date.now(),
        finishedAt: null,
        error: '',
      };
      jobs.set(account.id, job);
      void run(account, job);
      return publicJob(job);
    },
    get(accountId) {
      return publicJob(jobs.get(accountId));
    },
  };
}
