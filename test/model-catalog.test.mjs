import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelCatalog, publicModelId, resolveModelAlias } from '../model-catalog.mjs';

test('model catalog exposes short names and keeps upstream aliases internal', () => {
  const catalog = buildModelCatalog([
    { id: 'deepseek/deepseek-v4-pro', object: 'model', owned_by: 'deepseek' },
    { id: 'moonshotai/Kimi-K3' },
    { id: 'claude-sonnet-4-6' },
  ]);

  assert.equal(publicModelId('zai-org/GLM-5.3'), 'GLM-5.3');
  assert.deepEqual(catalog.models.map((model) => model.id), [
    'deepseek-v4-pro',
    'Kimi-K3',
    'claude-sonnet-4-6',
  ]);
  assert.deepEqual(resolveModelAlias(catalog, 'deepseek-v4-pro'), {
    id: 'deepseek-v4-pro',
    upstreamId: 'deepseek/deepseek-v4-pro',
  });
  assert.deepEqual(resolveModelAlias(catalog, 'moonshotai/Kimi-K3'), {
    id: 'Kimi-K3',
    upstreamId: 'moonshotai/Kimi-K3',
  });
  assert.equal(resolveModelAlias(catalog, 'not-a-model'), null);
});

test('model catalog skips duplicate short IDs instead of routing ambiguously', () => {
  const catalog = buildModelCatalog([
    { id: 'vendor-a/shared-model' },
    { id: 'vendor-b/shared-model' },
  ]);

  assert.deepEqual(catalog.models.map((model) => model.id), ['shared-model']);
  assert.equal(catalog.duplicates.length, 1);
  assert.deepEqual(resolveModelAlias(catalog, 'shared-model'), {
    id: 'shared-model',
    upstreamId: 'vendor-a/shared-model',
  });
});

test('separate account catalogs do not expose each other models', () => {
  const accountA = buildModelCatalog([{ id: 'vendor-a/model-a' }]);
  const accountB = buildModelCatalog([{ id: 'vendor-b/model-b' }]);

  assert.equal(resolveModelAlias(accountA, 'model-a').upstreamId, 'vendor-a/model-a');
  assert.equal(resolveModelAlias(accountB, 'model-a'), null);
  assert.equal(resolveModelAlias(accountA, 'model-b'), null);
});
