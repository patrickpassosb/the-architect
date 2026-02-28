"use client";

import {
  type ArtifactDetail,
  type ArtifactListItem,
  type AssistantResponse,
  type Mode,
  type Source
} from "@the-architect/shared-types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { MessageSquare, LayoutDashboard, FileText, Settings, BotMessageSquare } from "lucide-react";
import { ApiError, createSession, getArtifact, getArtifacts, sendMessage } from "@/lib/api";
import { useVoiceTranscript } from "@/hooks/useVoiceTranscript";

const DEFAULT_MODE: Mode = "architect";
const sidebarItems = [
  { name: "Chat", icon: MessageSquare },
  { name: "Sessions", icon: LayoutDashboard },
  { name: "Artifacts", icon: FileText },
  { name: "Prompts", icon: BotMessageSquare },
  { name: "Settings", icon: Settings },
] as const;

type ThreadMessage =
  | {
    id: string;
    role: "user";
    source: Source;
    content: string;
  }
  | {
    id: string;
    role: "assistant";
    source: Source;
    content: AssistantResponse;
  };

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

function createMessageId(prefix: "user" | "assistant"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function HomePage() {
  const voice = useVoiceTranscript();
  const clearVoiceTranscript = voice.clearTranscript;
  const threadBottomRef = useRef<HTMLDivElement | null>(null);

  const [mode, setMode] = useState<Mode>(DEFAULT_MODE);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [draftMessage, setDraftMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [thread, setThread] = useState<ThreadMessage[]>([]);

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
      setThread([]);
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

  useEffect(() => {
    threadBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread, isSending]);

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
      setThread((current) => [
        ...current,
        {
          id: createMessageId("user"),
          role: "user",
          source,
          content
        }
      ]);

      try {
        const response = await sendMessage(sessionId, { content, source });
        setThread((current) => [
          ...current,
          {
            id: createMessageId("assistant"),
            role: "assistant",
            source,
            content: response.assistant
          }
        ]);

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
    <main className="chat-app">
      <section className="workspace-shell">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <h2 className="brand-title">
              <span className="brand-icon">⬡</span>
              The Architect
            </h2>
            <p className="kicker">AI Co-founder Workspace</p>
          </div>

          <nav className="sidebar-nav" aria-label="Primary">
            {sidebarItems.map((item) => {
              const isActive = item.name === "Chat";
              const Icon = item.icon;
              return (
                <button key={item.name} type="button" className={`sidebar-link ${isActive ? "sidebar-link-active" : ""}`} aria-current={isActive ? "page" : undefined}>
                  <Icon className="sidebar-icon" size={18} />
                  {item.name}
                </button>
              );
            })}
          </nav>

          <div className="sidebar-footer">
            <span className="avatar">A</span>
            <p>Architect Session</p>
          </div>
        </aside>

        <section className="chat-shell">
          <header className="chat-header">
            <div className="heading-group">
              <h1>Focus, Decide, Ship</h1>
              <p className="muted">Chat-first workspace for architecture and execution.</p>
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

          <section className="conversation panel">
            <div className="message-stack">
              {thread.length === 0 && (
                <article className="message message-assistant message-empty">
                  <p className="message-meta">Assistant</p>
                  <p className="muted">No response yet. Send voice or text to start the conversation.</p>
                </article>
              )}

              {thread.map((message) => {
                if (message.role === "user") {
                  return (
                    <article key={message.id} className="message message-user">
                      <p className="message-meta">You ({message.source})</p>
                      <p className="message-body">{message.content}</p>
                    </article>
                  );
                }

                return (
                  <article key={message.id} className="message message-assistant">
                    <p className="message-meta">Assistant ({message.source})</p>
                    <div className="assistant-structured">
                      <section>
                        <h2>Summary</h2>
                        <p>{message.content.summary}</p>
                      </section>
                      <section>
                        <h2>Decision</h2>
                        <p>{message.content.decision}</p>
                      </section>
                      <section>
                        <h2>Next Actions</h2>
                        {message.content.next_actions.length === 0 ? (
                          <p className="muted">No next actions returned.</p>
                        ) : (
                          <ol>
                            {message.content.next_actions.map((item, index) => (
                              <li key={`${item}-${index}`}>{item}</li>
                            ))}
                          </ol>
                        )}
                      </section>
                    </div>
                  </article>
                );
              })}

              {isSending && (
                <article className="message message-assistant">
                  <p className="message-meta">Assistant</p>
                  <p className="muted">Thinking...</p>
                </article>
              )}
              <div ref={threadBottomRef} />
            </div>
          </section>

          <section className="composer panel">
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

            <div className="voice-tools">
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
                Voice Transcript
                <textarea
                  id="voice-transcript"
                  value={voice.fullTranscript}
                  readOnly
                  placeholder="Transcript appears here while recording"
                  rows={3}
                />
              </label>
            </div>
          </section>

          <section className="artifact-shell panel">
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

            <div className="artifact-grid">
              <ul className="artifact-list">
                {!sessionId && <li className="muted">Create a session to load artifacts.</li>}
                {sessionId && !artifactsLoading && artifacts.length === 0 && <li className="muted">No artifacts yet for this session.</li>}
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

              <article className="detail">
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
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
