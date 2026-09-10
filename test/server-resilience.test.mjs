import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import test from 'node:test';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() {
  const server = createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}

test('saved voice with offline speech service cannot crash the workspace server', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'clawdad-server-resilience-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const localPort = await port(), speechPort = await port();
  const base = `http://127.0.0.1:${localPort}`;
  const selection = { engine: 'kokoro', voice: 'af_heart', speed: 1 };
  await writeFile(path.join(root, 'voice-settings.json'), JSON.stringify({ selection, voicesByModel: { kokoro: selection } }));
  await writeFile(path.join(root, 'state.json'), JSON.stringify({ version: 3, projects: {} }));
  await writeFile(path.join(root, 'server.json'), JSON.stringify({ defaultProject: root }));
  await writeFile(path.join(root, 'token'), 'fixture-token');
  const child = spawn(process.execPath, ['lib/server.mjs', 'serve', '--host', '127.0.0.1', '--port', String(localPort),
    '--auth-mode', 'token', '--token-file', path.join(root, 'token'), '--config', path.join(root, 'server.json')], {
    env: { ...process.env, CLAWDAD_HOME: root,
      CLAWDAD_NATIVE_RUNTIME_VERSION: '', CLAWDAD_CODEX_APP_SERVER_MODE: 'isolated',
      CLAWDAD_DISABLE_QUEUED_DISPATCH_RESUME: '1', CLAWDAD_DISABLE_DELEGATE_SUPERVISOR_RESUME: '1',
      CLAWDAD_DOC_READER_TTS_FALLBACK_URL: `http://127.0.0.1:${speechPort}` },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errors = ''; child.stderr.on('data', data => { errors += data; });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, 'exit'); } });
  const get = route => fetch(base + route, { headers: { authorization: 'Bearer fixture-token' }, signal: AbortSignal.timeout(5000) });
  for (let n = 0; ; n++) {
    try { if ((await get('/healthz')).ok) break; } catch {}
    assert.ok(n < 100 && child.exitCode === null, errors); await pause(50);
  }
  const response = await get('/v1/tts/status');
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.ttsStatus.available, false);
  assert.equal(status.ttsStatus.errorCode, 'local_service_unavailable');
  assert.match(status.ttsStatus.error, /speech service/i);
  assert.equal((await get('/healthz')).status, 200);
  assert.equal((await get('/v1/whoami')).status, 200);
  assert.equal((await get('/v1/tts/voices')).status, 503);
  assert.equal(child.exitCode, null, errors);
  assert.doesNotMatch(errors, /triggerUncaughtException|UnhandledPromiseRejection/);

  // An unexpected routing exception must also be contained by the HTTP boundary.
  const malformed = await new Promise((resolve, reject) => {
    const req = request(base, { headers: { host: '[' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end();
  });
  assert.equal(malformed, 500);
  assert.equal((await get('/healthz')).status, 200);

  // The same process recovers the configured voice when its local service returns.
  const speech = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url === '/v1/voices' ? {
      schema: 'clawdad.local-voices/1', models: [{ id: 'kokoro', name: 'Kokoro', modelId: 'kokoro',
        installed: true, enabled: true, supportsSpeed: true, voices: [{id: 'af_heart'}] }],
    } : {ok: true}));
  });
  speech.listen(speechPort, '127.0.0.1'); await once(speech, 'listening');
  t.after(() => new Promise(resolve => speech.close(resolve)));
  const restored = await (await get('/v1/tts/status')).json();
  assert.equal(restored.ttsStatus.available, true);
  assert.equal((await get('/healthz')).status, 200);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'voice-settings.json'))),
    {selection, voicesByModel: {kokoro: selection}}, 'An outage must not replace the saved voice');
});
