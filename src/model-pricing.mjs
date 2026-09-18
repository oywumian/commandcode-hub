import { publicModelId } from '../model-catalog.mjs';

export const GO_PLAN_PRICING_META = Object.freeze({
  plan: 'go',
  sourceUrl: 'https://commandcode.ai/docs/plans/go',
  capturedAt: '2026-09-18',
  unit: 'USD per 1M tokens',
});

export const GO_PLAN_PRICING = Object.freeze([
  { id: 'laguna-s-2.1-free', name: 'Laguna S 2.1', contextWindow: '256K', input: 0, output: 0, cacheRead: 0, cacheWrite: null, free: true },
  { id: 'LongCat-2.0:free', name: 'LongCat 2.0', contextWindow: '1M', input: 0, output: 0, cacheRead: 0, cacheWrite: null, free: true },
  { id: 'ling-3.0-flash-sante:free', name: 'Ling 3.0 Flash Sante', contextWindow: '262K', input: 0, output: 0, cacheRead: 0, cacheWrite: null, free: true },
  { id: 'hy4-preview', name: 'Tencent Hy4 Preview', contextWindow: '1M', input: 0.834, output: 2.501, cacheRead: 0.042, cacheWrite: null },
  { id: 'hy3-paid', name: 'Tencent Hy3', contextWindow: '262K', input: 0.14, output: 0.58, cacheRead: 0.035, cacheWrite: null },
  { id: 'Kimi-K3', name: 'Kimi K3', contextWindow: '1M', input: 3, output: 15, cacheRead: 0.3, cacheWrite: null },
  { id: 'Kimi-K2.7-Code', name: 'Kimi K2.7 Code', contextWindow: '256K', input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: null },
  { id: 'Kimi-K2.7-Code-Highspeed', name: 'Kimi K2.7 Code HighSpeed', contextWindow: '262K', input: 1.9, output: 8, cacheRead: 0.38, cacheWrite: null },
  { id: 'Kimi-K2.6', name: 'Kimi K2.6', contextWindow: '256K', input: 0.95, output: 4, cacheRead: 0.16, cacheWrite: null },
  { id: 'Kimi-K2.5', name: 'Kimi K2.5', contextWindow: '256K', input: 0.6, output: 3, cacheRead: 0.1, cacheWrite: null },
  { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', contextWindow: '1M', input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: null },
  { id: 'GLM-5.3', name: 'GLM-5.3', contextWindow: '1M', input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: null },
  { id: 'GLM-5.2', name: 'GLM-5.2', contextWindow: '1M', input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: null },
  { id: 'GLM-5.2-Fast', name: 'GLM-5.2 Fast', contextWindow: '1M', input: 3, output: 10.25, cacheRead: 0.5, cacheWrite: null },
  { id: 'GLM-5.1', name: 'GLM-5.1', contextWindow: null, input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: null },
  { id: 'GLM-5', name: 'GLM-5', contextWindow: '200K', input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: null },
  { id: 'MiniMax-M3', name: 'MiniMax M3', contextWindow: '1M', input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: null, discountPercent: 50, original: { input: 0.6, output: 2.4, cacheRead: 0.12 } },
  { id: 'MiniMax-M2.7', name: 'MiniMax M2.7', contextWindow: null, input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: null },
  { id: 'MiniMax-M2.5', name: 'MiniMax M2.5', contextWindow: '200K', input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: null },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro (latest)', contextWindow: '1M', input: 0.66, output: 1.98, cacheRead: 0.022, cacheWrite: null, timeOfDay: { label: '非高峰价', peak: { input: 1.32, output: 3.96, cacheRead: null }, window: '周一至周五 01:00-04:00、06:00-10:00 UTC' } },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash (latest)', contextWindow: '1M', input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: null, timeOfDay: { label: '非高峰价', peak: { input: 0.3, output: 1.2, cacheRead: 0.006 }, window: '周一至周五 01:00-04:00、06:00-10:00 UTC' } },
  { id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek V4 Flash Vision (exp)', contextWindow: '1M', input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: null, timeOfDay: { label: '非高峰价', peak: { input: 0.3, output: 1.2, cacheRead: 0.006 }, window: '周一至周五 01:00-04:00、06:00-10:00 UTC' } },
  { id: 'deepseek-v4-flash-fast', name: 'DeepSeek V4 Flash Fast', contextWindow: '1M', input: 0.28, output: 0.56, cacheRead: 0.07, cacheWrite: null },
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', contextWindow: '1M', input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: null, timeOfDay: { label: '非高峰价', peak: { input: 0.3, output: 1.2, cacheRead: 0.006 }, window: '周一至周五 01:00-04:00、06:00-10:00 UTC' } },
  { id: 'Qwen3.8-Omni-Flash', name: 'Qwen 3.8 Omni Flash', contextWindow: '1M', input: 0.15, output: 0.47, cacheRead: 0.016, cacheWrite: null },
  { id: 'Qwen3.8-Max-0902', name: 'Qwen 3.8 Max 0902', contextWindow: '1M', input: 2, output: 6, cacheRead: 0.25, cacheWrite: null },
  { id: 'Qwen3.8-Max', name: 'Qwen 3.8 Max', contextWindow: '1M', input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5 },
  { id: 'Qwen3.8-27B', name: 'Qwen 3.8 27B', contextWindow: '262K', input: 0.4, output: 3, cacheRead: 0.04, cacheWrite: null },
  { id: 'Qwen3.6-Max-Preview', name: 'Qwen 3.6 Max Preview', contextWindow: null, input: 1.3, output: 7.8, cacheRead: 0.26, cacheWrite: 1.63 },
  { id: 'Qwen3.6-Plus', name: 'Qwen 3.6 Plus', contextWindow: null, input: 0.5, output: 3, cacheRead: 0.1, cacheWrite: null },
  { id: 'Qwen3.7-Max', name: 'Qwen 3.7 Max', contextWindow: '1M', input: 2.5, output: 7.5, cacheRead: 0.5, cacheWrite: 3.13 },
  { id: 'Qwen3.7-Plus', name: 'Qwen 3.7 Plus', contextWindow: '1M', input: 0.4, output: 1.6, cacheRead: 0.08, cacheWrite: 0.5 },
  { id: 'Qwen3.8-Flash', name: 'Qwen 3.8 Flash', contextWindow: '1M', input: 0.16, output: 0.47, cacheRead: 0.016, cacheWrite: null },
  { id: 'Qwen3.7-Flash', name: 'Qwen 3.7 Flash', contextWindow: '1M', input: 0.03, output: 0.13, cacheRead: 0.006, cacheWrite: 0.038 },
  { id: 'Step-3.7-Flash', name: 'Step 3.7 Flash', contextWindow: '256K', input: 0.2, output: 1.15, cacheRead: 0.04, cacheWrite: null },
  { id: 'Step-3.5-Flash', name: 'Step 3.5 Flash', contextWindow: '1M', input: 0.1, output: 0.3, cacheRead: 0.02, cacheWrite: null },
  { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro', contextWindow: '1M', input: 0.435, output: 0.87, cacheRead: 0.0036, cacheWrite: null, discountPercent: 99, original: { input: 2, output: 6, cacheRead: 0.4 } },
  { id: 'mimo-v2.5', name: 'MiMo V2.5', contextWindow: '1M', input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: null, discountPercent: 98, original: { input: 0.8, output: 4, cacheRead: 0.16 } },
  { id: 'nemotron-3-ultra-550b-a55b', name: 'Nemotron 3 Ultra', contextWindow: '1M', input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: null },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', contextWindow: '1.1M', input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
  { id: 'muse-spark-1.3-contributor', name: 'Muse Spark 1.3 Contributor', contextWindow: '1M', input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: null },
  { id: 'muse-spark-1.2-contributor', name: 'Muse Spark 1.2 Contributor', contextWindow: '1M', input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: null },
  { id: 'grok-4.5', name: 'Grok 4.5', contextWindow: '500K', input: 2, output: 6, cacheRead: 0.5, cacheWrite: null },
  { id: 'inkling', name: 'Inkling', contextWindow: '256K', input: 1, output: 4.05, cacheRead: 0.17, cacheWrite: null },
  { id: 'inkling-small', name: 'Inkling Small', contextWindow: '1M', input: 0.5, output: 1.2, cacheRead: 0.1, cacheWrite: null },
]);

const pricingByModelId = new Map(
  GO_PLAN_PRICING.map((item) => [publicModelId(item.id).toLowerCase(), item]),
);

export function getGoPlanPricing(modelId) {
  return pricingByModelId.get(publicModelId(modelId).toLowerCase()) || null;
}

export function estimateUsageCredits(usage, pricing) {
  if (!usage || !pricing) return null;
  if (pricing.free === true) return 0;
  const inputTokens = Math.max(0, Number(usage.inputTokens) || 0);
  const cachedTokens = Math.min(inputTokens, Math.max(0, Number(usage.cachedTokens) || 0));
  const outputTokens = Math.max(0, Number(usage.outputTokens) || 0);
  const inputRate = Number(pricing.input);
  const outputRate = Number(pricing.output);
  const cacheReadRate = Number(pricing.cacheRead);
  if (![inputRate, outputRate, cacheReadRate].every(Number.isFinite)) return null;
  return ((inputTokens - cachedTokens) * inputRate + outputTokens * outputRate + cachedTokens * cacheReadRate) / 1_000_000;
}
