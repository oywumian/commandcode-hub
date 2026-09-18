import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const listen = (server) => new Promise((resolvePort) => server.listen(0, '127.0.0.1', () => resolvePort(server.address().port)));
const close = (server) => new Promise((resolveClose) => server.close(resolveClose));
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function waitForHealth(port) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error('proxy did not become healthy');
}

test('proxy resolves short model names before forwarding to the account upstream', async () => {
  const generatedBodies = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};

    if (req.url === '/provider/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [
        { id: 'deepseek/deepseek-v4-pro', object: 'model', owned_by: 'deepseek' },
        { id: 'moonshotai/Kimi-K3', object: 'model', owned_by: 'moonshotai' },
      ] }));
      return;
    }
    if (req.url === '/alpha/fingerprint/record' || req.url === '/alpha/lifecycle-events') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    if (req.url === '/alpha/generate') {
      generatedBodies.push(body);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.end([
        JSON.stringify({ type: 'text-delta', text: 'ok' }),
        JSON.stringify({ type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 2, outputTokens: 1, cachedInputTokens: 0 } }),
      ].join('\n') + '\n');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  const upstreamPort = await listen(upstream);
  const proxyPort = await (async () => {
    const probe = http.createServer();
    const port = await listen(probe);
    await close(probe);
    return port;
  })();

  const child = spawn(process.execPath, ['proxy.mjs'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(proxyPort),
      HOST: '127.0.0.1',
      CC_API_BASE: `http://127.0.0.1:${upstreamPort}`,
      CC_USE_PROVIDER_MODELS: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childLogs = '';
  child.stdout.on('data', (chunk) => { childLogs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { childLogs += chunk.toString(); });

  try {
    await waitForHealth(proxyPort);
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer user_test_key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-v4-pro', stream: false, messages: [{ role: 'user', content: 'hello' }] }),
    });
    const data = await response.json();
    assert.equal(response.status, 200, childLogs);
    assert.equal(data.model, 'deepseek-v4-pro');
    assert.equal(generatedBodies.length, 1);
    assert.equal(generatedBodies[0].params.model, 'deepseek/deepseek-v4-pro');

    const denied = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer user_test_key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'unknown-model', stream: false, messages: [{ role: 'user', content: 'hello' }] }),
    });
    const deniedData = await denied.json();
    assert.equal(denied.status, 400);
    assert.match(deniedData.error.message, /not available/);
    assert.equal(generatedBodies.length, 1);
  } finally {
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), delay(3000)]);
    if (child.exitCode === null) child.kill();
    await close(upstream);
  }
});
