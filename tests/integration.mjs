import test from 'node:test';
import assert from 'node:assert/strict';

const API_BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000';
const WORKER_BASE = process.env.WORKER_BASE_URL ?? 'http://127.0.0.1:4100';

async function jfetch(path, init) {
  const res = await fetch(`${API_BASE}${path}`, init);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { res, json, text };
}

test('api health endpoint', async () => {
  const { res, json } = await jfetch('/api/health');
  assert.equal(res.status, 200);
  assert.equal(json?.status, 'ok');
});

test('worker health endpoint', async () => {
  const res = await fetch(`${WORKER_BASE}/health`);
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json?.ok, true);
});

test('create session + list artifacts', async () => {
  const created = await jfetch('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'architect', title: 'integration-test' })
  });

  assert.equal(created.res.status, 201);
  assert.ok(created.json?.id);

  const listed = await jfetch(`/api/sessions/${created.json.id}/artifacts`);
  assert.equal(listed.res.status, 200);
  assert.ok(Array.isArray(listed.json));
});

test('send message route responds deterministically', async () => {
  const created = await jfetch('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'architect' })
  });
  const sessionId = created.json.id;

  const sent = await jfetch(`/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'Design MVP architecture', source: 'text' })
  });

  // If key is configured in container, success shape should exist.
  // If key is missing, expected explicit config error.
  if (sent.res.status === 200) {
    assert.ok(sent.json?.assistant?.summary);
    assert.ok(Array.isArray(sent.json?.assistant?.next_actions));
  } else {
    assert.equal(sent.res.status, 500);
    assert.equal(sent.json?.error, 'MISTRAL_API_KEY is not configured');
  }
});
