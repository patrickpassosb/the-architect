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

const sidebarGroups = [
  {
    label: "Favorites",
    items: ["Performance Budget", "Accessibility Audit", "System Architecture", "API Documents"]
  },
  {
    label: "Coding and Data",
    items: ["Meeting Notes", "Database Schema", "Competitor Analysis", "Release Optimization"]
  },
  {
    label: "Design and Product",
    items: ["Landing Page Copy", "Mockup Generation", "Logo Concepts"]
  }
] as const;

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

function formatSessionId(id: string | null): string {
  if (!id) {
    return "Not created";
  }

  if (id.length <= 16) {
    return id;
  }

  return `${id.slice(0, 8)}...${id.slice(-8)}`;
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
    <main className="app-shell">
      <div className="bg-glow bg-glow-blue" aria-hidden="true" />
      <div className="bg-glow bg-glow-violet" aria-hidden="true" />

      <section className="workspace">
        <aside className="sidebar panel">
          <div className="brand">
            <p className="brand-kicker">Workspace</p>
            <h1>The Architect</h1>
          </div>

          <label className="search-wrap" htmlFor="sidebar-search">
            <span className="sr-only">Search workspace</span>
            <input id="sidebar-search" type="text" placeholder="Search..." readOnly value="" />
          </label>

          <div className="sidebar-scroll">
            {sidebarGroups.map((group) => (
              <section key={group.label} className="nav-group">
                <h2>{group.label}</h2>
                <ul>
                  {group.items.map((item) => (
                    <li key={item}>
                      <button type="button" className="nav-item">
                        {item}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <div className="profile-strip">
            <span className="avatar">A</span>
            <p>Architect Session</p>
          </div>
        </aside>

        <section className="main-area">
          <header className="topbar panel">
            <div>
              <p className="kicker">AI Build Assistant</p>
              <h2>Focus, Decide, Ship</h2>
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
              <button className="button button-primary" onClick={() => void createNewSession()} disabled={sessionLoading || isSending}>
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

          {voice.isSupported === false && (
            <section className="status status-warning">
              Speech recognition is unavailable in this browser. You can still send text messages.
            </section>
          )}

          {voice.error && (
            <section className="status status-warning">
              Voice error ({voice.error.code}): {voice.error.message}
            </section>
          )}

          <section className="chat-pane panel">
            <article className="bubble assistant-bubble">
              <h3>Assistant Response {lastSource ? <span>({lastSource})</span> : null}</h3>
              {!assistant ? (
                <p className="muted">No response yet. Send voice or text to receive a structured output.</p>
              ) : (
                <div className="assistant-grid">
                  <section>
                    <h4>Summary</h4>
                    <p>{assistant.summary}</p>
                  </section>
                  <section>
                    <h4>Decision</h4>
                    <p>{assistant.decision}</p>
                  </section>
                  <section>
                    <h4>Next Actions</h4>
                    {assistant.next_actions.length === 0 ? (
                      <p className="muted">No next actions returned.</p>
                    ) : (
                      <ol>
                        {assistant.next_actions.map((item, index) => (
                          <li key={`${item}-${index}`}>{item}</li>
                        ))}
                      </ol>
                    )}
                  </section>
                </div>
              )}
            </article>

            <article className="bubble voice-panel">
              <h3>Voice Input</h3>
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
                  className="button button-accent"
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
                  rows={4}
                />
              </label>
            </article>

            <article className="bubble composer">
              <label className="field" htmlFor="text-message">
                Message
                <textarea
                  id="text-message"
                  value={draftMessage}
                  onChange={(event) => setDraftMessage(event.target.value)}
                  placeholder="Ask for architecture, decisions, or execution plan"
                  rows={3}
                  disabled={!sessionId || isSending}
                />
              </label>
              <div className="composer-footer">
                <p className="session-pill" title={sessionId ?? "not created"}>
                  Session: <code>{formatSessionId(sessionId)}</code>
                </p>
                <button
                  className="button button-accent"
                  disabled={!sessionId || !draftMessage.trim() || isSending}
                  onClick={() => void send("text", draftMessage)}
                >
                  {isSending ? "Sending..." : "Send Text"}
                </button>
              </div>
            </article>
          </section>

          <section className="inspector-grid">
            <article className="panel artifacts">
              <div className="row spaced">
                <h3>Artifacts</h3>
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
              {sessionId && !artifactsLoading && artifacts.length === 0 && <p className="muted">No artifacts yet for this session.</p>}

              <ul className="artifact-list">
                {artifacts.map((artifact) => {
                  const isActive = selectedArtifact?.id === artifact.id;

                  return (
                    <li key={artifact.id}>
                      <button
                        className={`artifact-button ${isActive ? "artifact-button-active" : ""}`}
                        onClick={() => void openArtifact(artifact.id)}
                        aria-pressed={isActive}
                      >
                        <span className="artifact-title">{artifact.title}</span>
                        <small>{artifact.kind}</small>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </article>

            <article className="panel detail">
              <h3>Artifact Detail</h3>
              {artifactLoading && <p className="muted">Loading artifact...</p>}
              {artifactError && <p className="status-inline status-error">{artifactError}</p>}
              {!artifactLoading && !selectedArtifact && <p className="muted">Select an artifact to inspect markdown and JSON.</p>}

              {selectedArtifact && !artifactLoading && (
                <>
                  <p className="muted detail-meta">
                    {selectedArtifact.title ?? "Untitled"} ({selectedArtifact.kind})
                  </p>
                  <div className="markdown-frame">
                    <ReactMarkdown>{selectedArtifact.content_md || "_No markdown content_"}</ReactMarkdown>
                  </div>
                  <div className="json-block">
                    <h4>JSON Payload</h4>
                    <pre>{prettyJson ?? "No JSON payload returned for this artifact."}</pre>
                  </div>
                </>
              )}
            </article>
          </section>
        </section>
      </section>
    </main>
  );
}
