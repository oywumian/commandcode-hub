import test from 'node:test';
import assert from 'node:assert/strict';
import { GO_PLAN_PRICING, GO_PLAN_PRICING_META, getGoPlanPricing } from '../src/model-pricing.mjs';

test('Go pricing snapshot covers the published model catalog', () => {
  assert.equal(GO_PLAN_PRICING.length, 45);
  assert.equal(GO_PLAN_PRICING_META.plan, 'go');
  assert.equal(GO_PLAN_PRICING_META.unit, 'USD per 1M tokens');
});

test('Go pricing lookup accepts upstream and short model IDs', () => {
  assert.equal(getGoPlanPricing('deepseek/deepseek-v4-flash'), getGoPlanPricing('deepseek-v4-flash'));
  assert.equal(getGoPlanPricing('moonshotai/Kimi-K3').input, 3);
  assert.equal(getGoPlanPricing('MiniMaxAI/MiniMax-M3').discountPercent, 50);
  assert.equal(getGoPlanPricing('xiaomi/mimo-v2.5-pro').output, 0.87);
  assert.equal(getGoPlanPricing('poolside/laguna-s-2.1-free').free, true);
  assert.equal(getGoPlanPricing('not-in-catalog'), null);
});
