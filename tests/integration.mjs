/**
 * @fileoverview Integration Tests for 'The Architect'.
 *
 * Problem: We need to make sure the Web, API, and Worker all work
 * together correctly before we ship our code.
 *
 * Solution: An integration test suite that acts like a real user.
 * It creates a session, sends a message, and waits to make sure
 * a technical document (artifact) is eventually generated.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Configuration for where the services are running
const API_BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000';
const WORKER_BASE = process.env.WORKER_BASE_URL ?? 'http://127.0.0.1:4100';

// Configuration for how long to wait for the background worker
const REQUIRE_PROVIDER_SUCCESS = process.env.REQUIRE_PROVIDER_SUCCESS === '1';
const ARTIFACT_POLL_ATTEMPTS = Number(process.env.ARTIFACT_POLL_ATTEMPTS ?? '20');
const ARTIFACT_POLL_INTERVAL_MS = Number(process.env.ARTIFACT_POLL_INTERVAL_MS ?? '1000');

/**
 * Helper: Perform a JSON request and return the response and parsed JSON.
 */
async function jfetch(path, init) {
  const res = await fetch(`${API_BASE}${path}`, init);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { res, json, text };
}

/**
 * Helper: Wait for a specific amount of time.
 */
async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Problem: Background jobs take time to finish.
 * Solution: "Polling" - We keep checking the API every second until
 * the document appears, or until we give up (timeout).
 */
async function waitForArtifact(sessionId) {
  for (let attempt = 1; attempt <= ARTIFACT_POLL_ATTEMPTS; attempt += 1) {
    const listed = await jfetch(`/api/sessions/${sessionId}/artifacts`);
    assert.equal(listed.res.status, 200, `artifact list failed on attempt ${attempt}`);

    // If the list is no longer empty, the worker has finished!
    if (Array.isArray(listed.json) && listed.json.length > 0) {
      return listed.json;
    }

    // Wait before the next try
    if (attempt < ARTIFACT_POLL_ATTEMPTS) {
      await sleep(ARTIFACT_POLL_INTERVAL_MS);
    }
  }

  assert.fail(
    `Timed out waiting for artifacts after ${ARTIFACT_POLL_ATTEMPTS} attempts (${ARTIFACT_POLL_INTERVAL_MS}ms interval)`
  );
}

/**
 * Test: Is the API running?
 */
test('api health endpoint', async () => {
  const { res, json } = await jfetch('/api/health');
  assert.equal(res.status, 200);
  assert.equal(json?.status, 'ok');
});

/**
 * Test: Is the Worker running?
 */
test('worker health endpoint', async () => {
  const res = await fetch(`${WORKER_BASE}/health`);
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json?.ok, true);
});

/**
 * Test: Can we start a session and see the (initially empty) list of documents?
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
 * Full End-to-End Test:
 * 1. Create a session.
 * 2. Send a technical question.
 * 3. Verify the AI responds.
 * 4. Verify the Background Worker eventually generates a document.
 */
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

  // Handle cases where the MISTRAL_API_KEY might be missing during local tests
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

  // Check the AI's response structure
  assert.ok(sent.json?.assistant?.summary);
  assert.ok(Array.isArray(sent.json?.assistant?.next_actions));
  assert.ok(Array.isArray(sent.json?.queued_jobs));

  // Wait for the background worker to finish its job
  const artifacts = await waitForArtifact(sessionId);
  assert.ok(artifacts[0]?.id);
});
