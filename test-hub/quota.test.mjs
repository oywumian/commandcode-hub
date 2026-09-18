import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchQuota, planInfo } from '../src/quota.mjs';

test('quota normalization preserves real values and labels estimated monthly cap', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.includes('/whoami')) return Response.json({ user: { id: 'u1', userName: 'alice' }, org: { id: 'o1' } });
    if (url.includes('/credits')) return Response.json({ credits: { monthlyCredits: 22, purchasedCredits: 4, planId: 'individual-pro' }, windowLimits: { fiveHour: { used: 1.5, cap: 5, resetAt: '2026-09-18T12:00:00Z' }, weekly: { used: 8, cap: 20 } } });
    if (url.includes('/subscriptions')) return Response.json({ data: { planId: 'individual-pro', status: 'active', currentPeriodEnd: '2026-10-01T00:00:00Z' } });
    return Response.json({ totalTokensIn: 100, totalTokensOut: 20, totalCredits: 2 });
  };
  try {
    const report = await fetchQuota({ apiBase: 'https://example.test', upstreamCliVersion: '1.56.0' }, 'user_test');
    assert.equal(report.account.userName, 'alice');
    assert.equal(report.normalized.credits.fiveHour.used, 1.5);
    assert.equal(report.normalized.credits.weekly.cap, 20);
    assert.equal(report.normalized.monthly.cap, 30);
    assert.equal(report.normalized.monthly.remaining, 22);
    assert.equal(report.normalized.monthly.estimated, true);
    assert.equal(report.normalized.usage.totalTokensIn, 100);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('unknown plans do not invent a monthly cap', () => {
  assert.equal(planInfo('something-new'), null);
});
