import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsageParser } from '../src/usage-parser.mjs';

test('usage parser reads OpenAI JSON and Anthropic-style SSE usage', () => {
  const jsonParser = createUsageParser();
  jsonParser.push(JSON.stringify({ usage: { prompt_tokens: 12, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 3 } } }), 'application/json');
  assert.deepEqual(jsonParser.finish(), {
    inputTokens: 12, outputTokens: 5, cachedTokens: 3, reasoningTokens: 0, errorType: '', stopReason: '', toolCalls: 0, toolNames: [],
  });

  const streamParser = createUsageParser();
  streamParser.push('data: {"message":{"usage":{"input_tokens":7}}}\n\n', 'text/event-stream');
  streamParser.push('data: {"usage":{"output_tokens":9}}\n\n', 'text/event-stream');
  assert.deepEqual(streamParser.finish(), {
    inputTokens: 7, outputTokens: 9, cachedTokens: 0, reasoningTokens: 0, errorType: '', stopReason: '', toolCalls: 0, toolNames: [],
  });
});
