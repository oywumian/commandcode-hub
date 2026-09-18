export const DEFAULT_MODEL = 'deepseek-v4-flash';

export function publicModelId(upstreamId) {
  const value = String(upstreamId || '').trim();
  if (!value) return '';
  return value.split('/').pop() || value;
}

export function buildModelCatalog(rawModels) {
  const models = [];
  const byShortId = new Map();
  const byUpstreamId = new Map();
  const duplicates = [];

  for (const raw of Array.isArray(rawModels) ? rawModels : []) {
    const upstreamId = String(raw?.id || '').trim();
    const id = publicModelId(upstreamId);
    if (!upstreamId || !id) continue;
    if (byShortId.has(id)) {
      duplicates.push({ id, first: byShortId.get(id), skipped: upstreamId });
      continue;
    }
    const model = {
      id,
      upstreamId,
      name: String(raw?.name || id),
      object: raw?.object || 'model',
      created: raw?.created,
      owned_by: raw?.owned_by || 'command-code',
    };
    models.push(model);
    byShortId.set(id, upstreamId);
    byUpstreamId.set(upstreamId, upstreamId);
  }

  return { models, byShortId, byUpstreamId, duplicates };
}

export function resolveModelAlias(catalog, requestedId) {
  const requested = String(requestedId || '').trim();
  if (!requested) return null;
  const shortId = publicModelId(requested);
  const upstreamId = catalog?.byShortId?.get(shortId) || catalog?.byUpstreamId?.get(requested);
  return upstreamId ? { id: shortId, upstreamId } : null;
}
