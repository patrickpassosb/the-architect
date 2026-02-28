"use client";

import {
  type ArtifactDetail,
  type ArtifactListItem,
  type AssistantResponse,
  type Mode,
  type Source
} from "@the-architect/shared-types";
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ApiError, createSession, getArtifact, getArtifacts, sendMessage } from "@/lib/api";
import { useVoiceTranscript } from "@/hooks/useVoiceTranscript";

const DEFAULT_MODE: Mode = "architect";

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error";
}

function normalizeJsonPayload(payload: unknown): unknown {
  if (typeof payload !== "string") {
    return payload;
  }

  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

export default function HomePage() {
  const voice = useVoiceTranscript();
  const clearVoiceTranscript = voice.clearTranscript;

  const [mode, setMode] = useState<Mode>(DEFAULT_MODE);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [draftMessage, setDraftMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [assistant, setAssistant] = useState<AssistantResponse | null>(null);
  const [lastSource, setLastSource] = useState<Source | null>(null);

  const [artifacts, setArtifacts] = useState<ArtifactListItem[]>([]);
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  const [artifactsError, setArtifactsError] = useState<string | null>(null);
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactDetail | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);

  const createNewSession = useCallback(async () => {
    setSessionLoading(true);
    setSessionError(null);

    try {
      const response = await createSession({ mode });
      setSessionId(response.id);
      setArtifacts([]);
      setSelectedArtifact(null);
      setAssistant(null);
      setRequestError(null);
      clearVoiceTranscript();
    } catch (error) {
      setSessionError(getErrorMessage(error));
    } finally {
      setSessionLoading(false);
    }
  }, [clearVoiceTranscript, mode]);

  const loadArtifacts = useCallback(async (id: string) => {
    setArtifactsLoading(true);
    setArtifactsError(null);

    try {
      const list = await getArtifacts(id);
      setArtifacts(list);
    } catch (error) {
      setArtifactsError(getErrorMessage(error));
    } finally {
      setArtifactsLoading(false);
    }
  }, []);

  useEffect(() => {
    void createNewSession();
  }, [createNewSession]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    void loadArtifacts(sessionId);
  }, [loadArtifacts, sessionId]);

  const send = useCallback(
    async (source: Source, rawContent: string) => {
      if (!sessionId) {
        setRequestError("No active session");
        return;
      }

      const content = rawContent.trim();
      if (!content) {
        return;
      }

      setIsSending(true);
      setRequestError(null);

      try {
        const response = await sendMessage(sessionId, { content, source });
        setAssistant(response.assistant);
        setLastSource(source);

        if (source === "text") {
          setDraftMessage("");
        } else {
          clearVoiceTranscript();
        }

        await loadArtifacts(sessionId);
      } catch (error) {
        setRequestError(getErrorMessage(error));
      } finally {
        setIsSending(false);
      }
    },
    [clearVoiceTranscript, loadArtifacts, sessionId]
  );

  const openArtifact = useCallback(async (artifactId: string) => {
    setArtifactLoading(true);
    setArtifactError(null);

    try {
      const detail = await getArtifact(artifactId);
      setSelectedArtifact(detail);
    } catch (error) {
      setArtifactError(getErrorMessage(error));
    } finally {
      setArtifactLoading(false);
    }
  }, []);

  const prettyJson = useMemo(() => {
    if (!selectedArtifact?.content_json) {
      return null;
    }

    const normalized = normalizeJsonPayload(selectedArtifact.content_json);
    return JSON.stringify(normalized, null, 2);
  }, [selectedArtifact]);

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>The Architect</h1>
          <p>Voice-first CTO copilot with session + artifacts workflow.</p>
        </div>

        <div className="topbar-actions">
          <label className="field compact" htmlFor="mode-select">
            Mode
            <select
              id="mode-select"
              value={mode}
              onChange={(event) => setMode(event.target.value as Mode)}
              disabled={sessionLoading || isSending}
            >
              <option value="architect">Architect</option>
              <option value="planner">Planner</option>
              <option value="pitch">Pitch</option>
            </select>
          </label>

          <button className="button" onClick={() => void createNewSession()} disabled={sessionLoading || isSending}>
            {sessionLoading ? "Creating..." : "New Session"}
          </button>
        </div>
      </header>

      {(sessionError || requestError) && (
        <section className="status status-error">
          {sessionError && <p>Session error: {sessionError}</p>}
          {requestError && <p>Request error: {requestError}</p>}
        </section>
      )}

      {!voice.isSupported && (
        <section className="status status-warning">
          Speech recognition is unavailable in this browser. You can still send text messages.
        </section>
      )}

      {voice.error && (
        <section className="status status-warning">
          Voice error ({voice.error.code}): {voice.error.message}
        </section>
      )}

      <section className="grid">
        <div className="column">
          <section className="card">
            <h2>Voice Input</h2>
            <p className="muted">Record, review transcript, and send as <code>source=voice</code>.</p>

            <div className="row">
              <button
                className={`button ${voice.isRecording ? "button-danger" : "button-primary"}`}
                onClick={() => {
                  if (voice.isRecording) {
                    voice.stopRecording();
                    return;
                  }

                  void voice.startRecording();
                }}
                disabled={!sessionId || isSending}
              >
                {voice.isRecording ? "Stop Recording" : "Start Recording"}
              </button>

              <button className="button" onClick={voice.clearTranscript} disabled={!voice.fullTranscript || isSending}>
                Clear
              </button>

              <button
                className="button button-primary"
                onClick={() => void send("voice", voice.fullTranscript)}
                disabled={!sessionId || !voice.fullTranscript.trim() || isSending}
              >
                {isSending ? "Sending..." : "Send Voice"}
              </button>
            </div>

            <label className="field" htmlFor="voice-transcript">
              Transcript
              <textarea
                id="voice-transcript"
                value={voice.fullTranscript}
                readOnly
                placeholder="Transcript appears here while recording"
                rows={5}
              />
            </label>
          </section>

          <section className="card">
            <h2>Text Message</h2>
            <p className="muted">Fallback or follow-up input path with <code>source=text</code>.</p>
            <label className="field" htmlFor="text-message">
              Message
              <textarea
                id="text-message"
                value={draftMessage}
                onChange={(event) => setDraftMessage(event.target.value)}
                placeholder="Ask for architecture, decisions, or execution plan"
                rows={4}
                disabled={!sessionId || isSending}
              />
            </label>
            <div className="row">
              <button
                className="button button-primary"
                disabled={!sessionId || !draftMessage.trim() || isSending}
                onClick={() => void send("text", draftMessage)}
              >
                {isSending ? "Sending..." : "Send Text"}
              </button>
            </div>
          </section>

          <section className="card">
            <h2>Assistant Response</h2>
            {!assistant ? (
              <p className="muted">No response yet. Send a message to receive structured output.</p>
            ) : (
              <div className="assistant-response">
                <p>
                  <strong>Input source:</strong> {lastSource}
                </p>
                <p>
                  <strong>Summary:</strong> {assistant.summary}
                </p>
                <p>
                  <strong>Decision:</strong> {assistant.decision}
                </p>
                <div>
                  <strong>Next actions:</strong>
                  {assistant.next_actions.length === 0 ? (
                    <p className="muted">No next actions returned.</p>
                  ) : (
                    <ol>
                      {assistant.next_actions.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="column">
          <section className="card">
            <div className="row spaced">
              <h2>Artifacts</h2>
              <button
                className="button"
                onClick={() => sessionId && void loadArtifacts(sessionId)}
                disabled={!sessionId || artifactsLoading || isSending}
              >
                {artifactsLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            {artifactsError && <p className="status-inline status-error">{artifactsError}</p>}

            {!sessionId && <p className="muted">Create a session to load artifacts.</p>}
            {sessionId && !artifactsLoading && artifacts.length === 0 && (
              <p className="muted">No artifacts yet for this session.</p>
            )}

            <ul className="artifact-list">
              {artifacts.map((artifact) => (
                <li key={artifact.id}>
                  <button className="artifact-button" onClick={() => void openArtifact(artifact.id)}>
                    <span>{artifact.title}</span>
                    <small>{artifact.kind}</small>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="card artifact-detail">
            <h2>Artifact Detail</h2>
            {artifactLoading && <p className="muted">Loading artifact...</p>}
            {artifactError && <p className="status-inline status-error">{artifactError}</p>}

            {!artifactLoading && !selectedArtifact && <p className="muted">Select an artifact to inspect markdown and JSON.</p>}

            {selectedArtifact && !artifactLoading && (
              <>
                <p className="muted">
                  {selectedArtifact.title ?? "Untitled"} ({selectedArtifact.kind})
                </p>

                <div className="markdown-frame">
                  <ReactMarkdown>{selectedArtifact.content_md || "_No markdown content_"}</ReactMarkdown>
                </div>

                <div className="json-block">
                  <h3>JSON Payload</h3>
                  <pre>{prettyJson ?? "No JSON payload returned for this artifact."}</pre>
                </div>
              </>
            )}
          </section>
        </div>
      </section>

      <footer className="footer muted">
        <p>Session: {sessionId ?? "not created"}</p>
      </footer>
    </main>
  );
}
