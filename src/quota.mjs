const KNOWN_PLANS = {
  'individual-go': { name: 'Go', monthlyCredits: 10 },
  'individual-goat': { name: 'GOAT', monthlyCredits: 70 },
  'individual-pro-v1': { name: 'Pro', monthlyCredits: 80 },
  'individual-pro': { name: 'Pro', monthlyCredits: 30 },
  'individual-provider': { name: 'Provider', monthlyCredits: 15 },
  'individual-max': { name: 'Max', monthlyCredits: 150 },
  'individual-ultra': { name: 'Ultra', monthlyCredits: 300 },
  'teams-pro': { name: 'Teams Pro', monthlyCredits: 40 },
};

const PLAN_PREFIXES = Object.keys(KNOWN_PLANS).sort((a, b) => b.length - a.length);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const string = (value) => typeof value === 'string' ? value : null;

function toEpochMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export function planInfo(planId) {
  if (!planId) return null;
  const normalized = String(planId).toLowerCase().replaceAll('_', '-');
  const prefix = PLAN_PREFIXES.find((candidate) => normalized.startsWith(candidate));
  return prefix ? KNOWN_PLANS[prefix] : null;
}

function normalizeWindow(raw) {
  if (!isRecord(raw)) return null;
  const used = number(raw.used) ?? number(raw.usage) ?? number(raw.usedCredits) ?? number(raw.used_credits);
  const cap = number(raw.cap) ?? number(raw.limit) ?? number(raw.capCredits);
  return {
    used,
    cap,
    exceeded: raw.exceeded === true || raw.exceeded === 'true' || (used !== null && cap !== null && cap > 0 && used >= cap),
    resetAt: toEpochMs(raw.resetAt ?? raw.reset_at ?? raw.resetsAt),
  };
}

function pickWindow(limits, names) {
  for (const name of names) if (isRecord(limits?.[name])) return limits[name];
  return null;
}

async function getJson(config, path, apiKey) {
  const response = await fetch(`${config.apiBase}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'User-Agent': 'cli',
      'x-command-code-version': config.upstreamCliVersion,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    error.detail = text.slice(0, 300);
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error('Upstream returned invalid JSON');
    error.status = 502;
    throw error;
  }
}

function normalizeCredits(payload) {
  const data = isRecord(payload?.data) ? payload.data : payload;
  const credits = isRecord(payload?.credits) ? payload.credits : isRecord(data?.credits) ? data.credits : {};
  const limits = isRecord(payload?.windowLimits) ? payload.windowLimits : isRecord(data?.windowLimits) ? data.windowLimits : {};
  return {
    monthlyCredits: number(credits.monthlyCredits) ?? number(credits.monthly_credits),
    purchasedCredits: number(credits.purchasedCredits) ?? number(credits.purchased_credits),
    freeCredits: number(credits.freeCredits) ?? number(credits.free_credits),
    planId: string(credits.planId) ?? string(credits.plan_id),
    limited: limits.limited === true,
    exceeded: string(limits.exceeded) ?? '',
    belowThreshold: credits.belowThreshold === true,
    creditThreshold: number(credits.creditThreshold),
    fiveHour: normalizeWindow(pickWindow(limits, ['fiveHour', 'five_hour', 'rolling5h', '5h'])),
    weekly: normalizeWindow(pickWindow(limits, ['weekly', 'week'])),
  };
}

function normalizeUsage(payload) {
  const value = isRecord(payload?.data) ? payload.data : payload;
  if (!isRecord(value)) return null;
  return {
    totalCount: number(value.totalCount),
    totalCost: number(value.totalCost),
    averageCost: number(value.averageCost),
    successRate: number(value.successRate),
    completedCount: number(value.completedCount),
    failedCount: number(value.failedCount),
    totalTokensIn: number(value.totalTokensIn),
    totalTokensOut: number(value.totalTokensOut),
    totalCredits: number(value.totalCredits),
    periodBasis: string(value.periodBasis) ?? '',
  };
}

function normalizePlan(payload, fallbackPlanId) {
  const data = isRecord(payload?.data) ? payload.data : isRecord(payload?.subscription) ? payload.subscription : null;
  const planId = string(data?.planId) ?? string(data?.plan_id) ?? fallbackPlanId ?? '';
  if (!data && !planId) return null;
  const known = planInfo(planId);
  return {
    planId,
    name: known?.name || planId,
    status: string(data?.status) ?? '',
    estimatedMonthlyCap: known?.monthlyCredits ?? null,
    currentPeriodStart: toEpochMs(data?.currentPeriodStart ?? data?.current_period_start),
    currentPeriodEnd: toEpochMs(data?.currentPeriodEnd ?? data?.current_period_end),
    cancelAtPeriodEnd: data?.cancelAtPeriodEnd === true,
    pendingPhase: data?.pendingPhase ?? null,
  };
}

export async function fetchQuota(config, apiKey) {
  const fetchedAt = Date.now();
  const failures = [];
  const raw = {};

  let whoami;
  try {
    whoami = raw.whoami = await getJson(config, '/alpha/whoami?limits=1', apiKey);
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      const rejected = new Error('Command Code API key was rejected');
      rejected.status = error.status;
      throw rejected;
    }
    failures.push(`whoami: ${error.message}`);
  }

  const user = isRecord(whoami?.user) ? whoami.user : isRecord(whoami?.data?.user) ? whoami.data.user : {};
  const orgId = string(whoami?.org?.id);
  const paths = {
    credits: '/alpha/billing/credits',
    subscription: `/alpha/billing/subscriptions${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''}`,
    usage: '/alpha/usage/summary',
  };
  const results = await Promise.allSettled(Object.entries(paths).map(async ([name, path]) => [name, await getJson(config, path, apiKey)]));
  for (const result of results) {
    if (result.status === 'fulfilled') raw[result.value[0]] = result.value[1];
    else failures.push(result.reason?.message || 'Unknown upstream error');
  }

  const credits = normalizeCredits(raw.credits || {});
  const plan = normalizePlan(raw.subscription, credits.planId);
  const usage = normalizeUsage(raw.usage);
  const monthlyCap = plan?.estimatedMonthlyCap ?? null;
  const monthlyRemaining = credits.monthlyCredits;
  const monthly = monthlyCap === null || monthlyRemaining === null ? null : {
    used: Math.max(0, monthlyCap - monthlyRemaining),
    cap: monthlyCap,
    remaining: monthlyRemaining,
    resetAt: plan.currentPeriodEnd,
    estimated: true,
  };

  if (!whoami && !raw.credits && !raw.subscription) {
    const error = new Error(`No quota endpoint succeeded: ${failures.join('; ')}`);
    error.status = 502;
    throw error;
  }

  return {
    fetchedAt,
    account: {
      id: string(user.id) ?? '',
      name: string(user.name) ?? '',
      userName: string(user.userName) ?? string(user.username) ?? '',
    },
    plan,
    normalized: { credits, monthly, usage, failures },
    raw,
  };
}
