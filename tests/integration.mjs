import test from 'node:test';
import assert from 'node:assert/strict';

const API_BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000';
const WORKER_BASE = process.env.WORKER_BASE_URL ?? 'http://127.0.0.1:4100';
const REQUIRE_PROVIDER_SUCCESS = process.env.REQUIRE_PROVIDER_SUCCESS === '1';
const ARTIFACT_POLL_ATTEMPTS = Number(process.env.ARTIFACT_POLL_ATTEMPTS ?? '20');
const ARTIFACT_POLL_INTERVAL_MS = Number(process.env.ARTIFACT_POLL_INTERVAL_MS ?? '1000');

async function jfetch(path, init) {
  const res = await fetch(`${API_BASE}${path}`, init);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { res, json, text };
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForArtifact(sessionId) {
  for (let attempt = 1; attempt <= ARTIFACT_POLL_ATTEMPTS; attempt += 1) {
    const listed = await jfetch(`/api/sessions/${sessionId}/artifacts`);
    assert.equal(listed.res.status, 200, `artifact list failed on attempt ${attempt}`);
    if (Array.isArray(listed.json) && listed.json.length > 0) {
      return listed.json;
    }

    if (attempt < ARTIFACT_POLL_ATTEMPTS) {
      await sleep(ARTIFACT_POLL_INTERVAL_MS);
    }
  }

  assert.fail(
    `Timed out waiting for artifacts after ${ARTIFACT_POLL_ATTEMPTS} attempts (${ARTIFACT_POLL_INTERVAL_MS}ms interval)`
  );
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

test('send message route responds and artifact is eventually generated', async () => {
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

  if (sent.res.status !== 200) {
    if (REQUIRE_PROVIDER_SUCCESS) {
      assert.fail(
        `Expected 200 from /messages but got ${sent.res.status}: ${sent.text}`
      );
    }

    assert.equal(sent.res.status, 500);
    assert.equal(sent.json?.error, 'MISTRAL_API_KEY is not configured');
    return;
  }

  assert.ok(sent.json?.assistant?.summary);
  assert.ok(Array.isArray(sent.json?.assistant?.next_actions));
  assert.ok(Array.isArray(sent.json?.queued_jobs));

  const artifacts = await waitForArtifact(sessionId);
  assert.ok(artifacts[0]?.id);
});
