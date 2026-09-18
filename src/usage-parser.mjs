function applyUsage(target, usage) {
  if (!usage || typeof usage !== 'object') return;
  target.inputTokens = Math.max(target.inputTokens, usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokens ?? 0);
  target.outputTokens = Math.max(target.outputTokens, usage.completion_tokens ?? usage.output_tokens ?? usage.outputTokens ?? 0);
  target.cachedTokens = Math.max(target.cachedTokens,
    usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens ?? usage.cachedInputTokens ?? 0);
  target.reasoningTokens = Math.max(target.reasoningTokens,
    usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens ?? usage.reasoningTokens ?? 0);
}

function inspectObject(target, value) {
  if (!value || typeof value !== 'object') return;
  applyUsage(target, value.usage);
  applyUsage(target, value.response?.usage);
  if (value.message?.usage) applyUsage(target, value.message.usage);
  if (value.error?.type) target.errorType = String(value.error.type).slice(0, 80);
}

export function createUsageParser() {
  const usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, errorType: '' };
  let lineBuffer = '';
  let bodyBuffer = '';

  return {
    push(chunk, contentType = '') {
      const text = Buffer.from(chunk).toString('utf8');
      if (contentType.includes('text/event-stream')) {
        lineBuffer += text;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try { inspectObject(usage, JSON.parse(data)); } catch {}
        }
      } else if (bodyBuffer.length < 2_000_000) {
        bodyBuffer += text;
      }
    },
    finish() {
      if (lineBuffer.startsWith('data:')) {
        try { inspectObject(usage, JSON.parse(lineBuffer.slice(5).trim())); } catch {}
      }
      if (bodyBuffer) {
        try { inspectObject(usage, JSON.parse(bodyBuffer)); } catch {}
      }
      return usage;
    },
  };
}
