/**
 * @fileoverview Main Page for the 'The Architect' Web Application.
 *
 * Problem: Users need a high-quality, real-time interface to talk to the AI,
 * record their voice, and view generated technical documents (artifacts).
 *
 * Solution: A Next.js 15 React component that manages the state of the chat
 * (the 'thread'), the active session, and the list of documents. It uses
 * Tailwind CSS for styling and Lucide for icons.
 */

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

// Default behavior settings
const DEFAULT_MODE: Mode = "architect";

// Navigation items for the sidebar
const sidebarItems = [
  { name: "Chat", icon: MessageSquare },
  { name: "Sessions", icon: LayoutDashboard },
  { name: "Artifacts", icon: FileText },
  { name: "Prompts", icon: BotMessageSquare },
  { name: "Settings", icon: Settings },
] as const;

/**
 * Define what a message looks like in our local UI state.
 */
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

/**
 * Helper: Extract a readable string from various error types.
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error";
}

/**
 * Helper: Ensure JSON data is an object, not a string.
 */
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

/**
 * Helper: Shorten long IDs for display (e.g., "abcd...1234").
 */
function formatSessionId(id: string | null): string {
  if (!id) {
    return "Not created";
  }

  if (id.length <= 16) {
    return id;
  }

  return `${id.slice(0, 8)}...${id.slice(-8)}`;
}

/**
 * Helper: Generate a temporary unique ID for messages before they are saved.
 */
function createMessageId(prefix: "user" | "assistant"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Main React Component
 */
export default function HomePage() {
  // Voice Recording Hook (Logic is separated for cleanliness)
  const voice = useVoiceTranscript();
  const clearVoiceTranscript = voice.clearTranscript;

  // Ref used to automatically scroll to the bottom of the chat
  const threadBottomRef = useRef<HTMLDivElement | null>(null);

  /**
   * React State Management
   * Problem: React needs to "remember" things like the current session ID
   * and the messages in the chat.
   * Solution: Use 'useState' hooks to track these values.
   */
  const [mode, setMode] = useState<Mode>(DEFAULT_MODE);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [draftMessage, setDraftMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  // The actual list of messages shown in the UI
  const [thread, setThread] = useState<ThreadMessage[]>([]);

  // Documents (Artifacts) state
  const [artifacts, setArtifacts] = useState<ArtifactListItem[]>([]);
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  const [artifactsError, setArtifactsError] = useState<string | null>(null);
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactDetail | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);

  /**
   * Action: Start a new session.
   */
  const createNewSession = useCallback(async () => {
    setSessionLoading(true);
    setSessionError(null);

    try {
      const response = await createSession({ mode });
      setSessionId(response.id);
      // Reset UI state for the new session
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

  /**
   * Action: Load the list of documents for the current session.
   */
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

  /**
   * Effect: Automatically create a session when the app first loads.
   */
  useEffect(() => {
    void createNewSession();
  }, [createNewSession]);

  /**
   * Effect: Fetch documents whenever the session ID changes.
   */
  useEffect(() => {
    if (!sessionId) {
      return;
    }

    void loadArtifacts(sessionId);
  }, [loadArtifacts, sessionId]);

  /**
   * Effect: Keep the chat scrolled to the bottom.
   */
  useEffect(() => {
    threadBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread, isSending]);

  /**
   * Action: Send a message (Text or Voice).
   *
   * Problem: We want the UI to feel fast.
   * Solution: "Optimistic UI" - Add the user's message to the thread
   * immediately before the API call finishes.
   */
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

      // Add user message to UI immediately
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
        // Send to API
        const response = await sendMessage(sessionId, { content, source });

        // Add AI response to UI
        setThread((current) => [
          ...current,
          {
            id: createMessageId("assistant"),
            role: "assistant",
            source,
            content: response.assistant
          }
        ]);

        // Cleanup input fields
        if (source === "text") {
          setDraftMessage("");
        } else {
          clearVoiceTranscript();
        }

        // Refresh documents (as one might have been generated)
        await loadArtifacts(sessionId);
      } catch (error) {
        setRequestError(getErrorMessage(error));
      } finally {
        setIsSending(false);
      }
    },
    [clearVoiceTranscript, loadArtifacts, sessionId]
  );

  /**
   * Action: View a specific document's details.
   */
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

  /**
   * Memoized Value: Format the JSON for pretty display.
   */
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
        {/* Sidebar: Navigation and Branding */}
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

        {/* Main Chat Area */}
        <section className="chat-shell">
          <header className="chat-header">
            <div className="heading-group">
              <h1>Focus, Decide, Ship</h1>
              <p className="muted">Chat-first workspace for architecture and execution.</p>
            </div>

            <div className="topbar-actions">
              {/* Mode Selector (Architect, Planner, Pitch) */}
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

          {/* Error Notifications */}
          {(sessionError || requestError) && (
            <section className="status status-error">
              {sessionError && <p>Session error: {sessionError}</p>}
              {requestError && <p>Request error: {requestError}</p>}
            </section>
          )}

          {/* Voice Compatibility Warnings */}
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

          {/* Conversation History */}
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

                // AI Response - Structured for easy reading
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

              {/* Thinking state for AI */}
              {isSending && (
                <article className="message message-assistant">
                  <p className="message-meta">Assistant</p>
                  <p className="muted">Thinking...</p>
                </article>
              )}
              <div ref={threadBottomRef} />
            </div>
          </section>

          {/* Message Composer (Text and Voice) */}
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

            {/* Voice Input Section */}
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

          {/* Documents (Artifacts) Viewer */}
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
              {/* List of document titles */}
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

              {/* Full Document Detail */}
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
                    {/* Render the Markdown content nicely */}
                    <div className="markdown-frame">
                      <ReactMarkdown>{selectedArtifact.content_md || "_No markdown content_"}</ReactMarkdown>
                    </div>
                    {/* Show the machine-readable JSON part */}
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
