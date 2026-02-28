import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Integration test suite for The Architect.
 * Validates the core API endpoints and worker orchestration.
 */

const API_BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000';
const WORKER_BASE = process.env.WORKER_BASE_URL ?? 'http://127.0.0.1:4100';

/**
 * Helper to perform a JSON-based fetch request to the API.
 * @param path - The relative API path.
 * @param init - Fetch RequestInit options.
 */
async function jfetch(path, init) {
  const res = await fetch(`${API_BASE}${path}`, init);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { res, json, text };
}

/**
 * Verifies that the API health endpoint is reachable and returns an OK status.
 */
test('api health endpoint', async () => {
  const { res, json } = await jfetch('/api/health');
  assert.equal(res.status, 200);
  assert.equal(json?.status, 'ok');
});

/**
 * Verifies that the worker health endpoint is reachable and returns an OK status.
 */
test('worker health endpoint', async () => {
  const res = await fetch(`${WORKER_BASE}/health`);
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json?.ok, true);
});

/**
 * Validates the session creation flow and the ability to list artifacts for a new session.
 */
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

/**
 * Ensures that sending a message returns a deterministic response or a clear configuration error.
 */
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

  // If Mistral API key is configured, verify the successful response shape.
  // If the key is missing, verify the explicit configuration error returned by the API.
  if (sent.res.status === 200) {
    assert.ok(sent.json?.assistant?.summary);
    assert.ok(Array.isArray(sent.json?.assistant?.next_actions));
  } else {
    assert.equal(sent.res.status, 500);
    assert.equal(sent.json?.error, 'MISTRAL_API_KEY is not configured');
  }
});
