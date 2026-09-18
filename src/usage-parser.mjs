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
  const toolCallKeys = new Set();
  const toolNames = new Set();
  let stopReason = '';

  function observeToolCall(call) {
    if (!call || typeof call !== 'object') return;
    const id = call.id ?? call.toolCallId ?? call.index;
    const name = call.function?.name || call.toolName || call.name || '';
    const key = String(id ?? `${toolCallKeys.size}:${name}`);
    if (!toolCallKeys.has(key)) {
      toolCallKeys.add(key);
      if (name) toolNames.add(String(name).slice(0, 80));
    }
  }

  function observeTools(value) {
    for (const choice of value.choices || []) {
      const calls = choice.delta?.tool_calls || choice.message?.tool_calls || [];
      for (const call of calls) observeToolCall(call);
      if (choice.finish_reason) stopReason = String(choice.finish_reason).slice(0, 40);
    }
    if (value.type === 'content_block_start' && value.content_block?.type === 'tool_use') {
      observeToolCall(value.content_block);
    }
    if (value.type === 'tool-call') {
      observeToolCall(value);
    }
    if (value.type === 'response.output_item.added' && value.item?.type === 'function_call') {
      observeToolCall(value.item);
    }
    if (value.stop_reason) stopReason = String(value.stop_reason).slice(0, 40);
  }
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
          try {
            const value = JSON.parse(data);
            inspectObject(usage, value);
            observeTools(value);
          } catch {}
        }
      } else if (bodyBuffer.length < 2_000_000) {
        bodyBuffer += text;
      }
    },
    finish() {
      if (lineBuffer.startsWith('data:')) {
        try {
          const value = JSON.parse(lineBuffer.slice(5).trim());
          inspectObject(usage, value);
          observeTools(value);
        } catch {}
      }
      if (bodyBuffer) {
        try {
          const value = JSON.parse(bodyBuffer);
          inspectObject(usage, value);
          observeTools(value);
        } catch {}
      }
      return { ...usage, stopReason, toolCalls: toolCallKeys.size, toolNames: [...toolNames] };
    },
  };
}
