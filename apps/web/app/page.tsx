"use client";

import {
  type ArtifactDetail,
  type ArtifactListItem,
  type AssistantResponse,
  type Mode,
  type RunBuildResponse,
  type Source
} from "@the-architect/shared-types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  MessageSquare,
  LayoutDashboard,
  Hammer,
  Play,
  Volume2,
  Loader2,
  Sparkles,
  Mic,
  Square
} from "lucide-react";
import {
  ApiError,
  createSession,
  getArtifact,
  getArtifacts,
  runBuildWithVibe,
  sendMessage,
  synthesizeVoice
} from "@/lib/api";
import { useVoiceTranscript } from "@/hooks/useVoiceTranscript";

const DEFAULT_MODE: Mode = "architect";

type WorkspacePanel = "chat" | "architecture" | "build";

const sidebarItems: Array<{
  name: string;
  panel: WorkspacePanel;
  icon: React.ComponentType<{ className?: string; size?: number }>;
}> = [
    { name: "Chat", panel: "chat", icon: MessageSquare },
    { name: "Architecture", panel: "architecture", icon: LayoutDashboard },
    { name: "Build with Vibe", panel: "build", icon: Hammer }
  ];

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

function parseMermaidFromMarkdown(markdown: string): string | null {
  const match = markdown.match(/```mermaid\s*([\s\S]*?)\s*```/i);
  return match?.[1]?.trim() ?? null;
}

function encodeBase64Utf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return window.btoa(binary);
}

function base64ToBlob(base64: string, contentType: string): Blob {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: contentType });
}

export default function HomePage() {
  const voice = useVoiceTranscript();
  const clearVoiceTranscript = voice.clearTranscript;
  const threadBottomRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [activePanel, setActivePanel] = useState<WorkspacePanel>("chat");

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

  const [architectureArtifact, setArchitectureArtifact] = useState<ArtifactDetail | null>(null);
  const [architectureLoading, setArchitectureLoading] = useState(false);
  const [architectureError, setArchitectureError] = useState<string | null>(null);

  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);

  const [buildGoal, setBuildGoal] = useState("");
  const [buildDryRun, setBuildDryRun] = useState(false);
  const [buildLoading, setBuildLoading] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [buildResult, setBuildResult] = useState<RunBuildResponse | null>(null);

  const latestAssistantMessage = useMemo(() => {
    for (let index = thread.length - 1; index >= 0; index -= 1) {
      const item = thread[index];
      if (item.role === "assistant") {
        return item;
      }
    }

    return null;
  }, [thread]);

  const loadLatestArchitecture = useCallback(async (
    id: string,
    knownArtifacts?: ArtifactListItem[]
  ) => {
    setArchitectureLoading(true);
    setArchitectureError(null);

    try {
      const list = knownArtifacts ?? (await getArtifacts(id));
      const latestArchitectureItem = list.find((item) => item.kind === "architecture");

      if (!latestArchitectureItem) {
        setArchitectureArtifact(null);
        setArchitectureError("No architecture artifact yet. Send a message first.");
        return;
      }

      const detail = await getArtifact(latestArchitectureItem.id);
      setArchitectureArtifact(detail);
      if (!selectedArtifact || selectedArtifact.id === latestArchitectureItem.id) {
        setSelectedArtifact(detail);
      }
    } catch (error) {
      setArchitectureError(getErrorMessage(error));
    } finally {
      setArchitectureLoading(false);
    }
  }, [selectedArtifact]);

  const createNewSession = useCallback(async () => {
    setSessionLoading(true);
    setSessionError(null);

    try {
      const response = await createSession({ mode });
      setSessionId(response.id);
      setArtifacts([]);
      setSelectedArtifact(null);
      setArchitectureArtifact(null);
      setArchitectureError(null);
      setThread([]);
      setRequestError(null);
      setBuildResult(null);
      setBuildError(null);
      setBuildGoal("");
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
      await loadLatestArchitecture(id, list);
    } catch (error) {
      setArtifactsError(getErrorMessage(error));
    } finally {
      setArtifactsLoading(false);
    }
  }, [loadLatestArchitecture]);

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
    if (activePanel !== "chat") {
      return;
    }

    threadBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activePanel, thread, isSending]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

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
      if (detail.kind === "architecture") {
        setArchitectureArtifact(detail);
      }
    } catch (error) {
      setArtifactError(getErrorMessage(error));
    } finally {
      setArtifactLoading(false);
    }
  }, []);

  const speakAssistant = useCallback(async (messageId: string, content: AssistantResponse) => {
    setSpeechError(null);
    setSpeakingId(messageId);

    try {
      const speechText = [
        content.summary,
        `Decision: ${content.decision}`,
        content.next_actions.length > 0
          ? `Next actions: ${content.next_actions.join(". ")}`
          : ""
      ]
        .filter(Boolean)
        .join(". ");

      const result = await synthesizeVoice({
        text: speechText.slice(0, 2_000)
      });

      const blob = base64ToBlob(result.audio_base64, result.content_type);
      const url = URL.createObjectURL(blob);

      audioRef.current?.pause();
      audioRef.current = new Audio(url);
      audioRef.current.onended = () => {
        URL.revokeObjectURL(url);
        setSpeakingId(null);
      };
      await audioRef.current.play();
    } catch (error) {
      setSpeechError(getErrorMessage(error));
      setSpeakingId(null);
    }
  }, []);

  const architectureJson = useMemo(() => {
    if (!architectureArtifact?.content_json) {
      return null;
    }

    return normalizeJsonPayload(architectureArtifact.content_json);
  }, [architectureArtifact]);

  const architectureMermaid = useMemo(() => {
    const jsonValue = architectureJson;
    if (jsonValue && typeof jsonValue === "object" && "diagram_mermaid" in jsonValue) {
      const maybeMermaid = (jsonValue as { diagram_mermaid?: unknown }).diagram_mermaid;
      if (typeof maybeMermaid === "string" && maybeMermaid.trim()) {
        return maybeMermaid.trim();
      }
    }

    if (!architectureArtifact?.content_md) {
      return null;
    }

    return parseMermaidFromMarkdown(architectureArtifact.content_md);
  }, [architectureArtifact, architectureJson]);

  const architectureDiagramUrl = useMemo(() => {
    if (!architectureMermaid) {
      return null;
    }

    try {
      return `https://mermaid.ink/img/${encodeBase64Utf8(architectureMermaid)}`;
    } catch {
      return null;
    }
  }, [architectureMermaid]);

  const architectureStack = useMemo(() => {
    const jsonValue = architectureJson;

    if (jsonValue && typeof jsonValue === "object" && "tech_stack" in jsonValue) {
      const maybeStack = (jsonValue as { tech_stack?: unknown }).tech_stack;
      if (maybeStack && typeof maybeStack === "object" && !Array.isArray(maybeStack)) {
        return Object.entries(maybeStack).map(([key, value]) => ({
          key,
          value: String(value)
        }));
      }
    }

    return [
      { key: "frontend", value: "Next.js + React" },
      { key: "api", value: "Fastify + TypeScript" },
      { key: "queue", value: "BullMQ + Redis" },
      { key: "worker", value: "Node.js worker" },
      { key: "database", value: "SQLite" },
      { key: "ai", value: "Mistral + ElevenLabs" }
    ];
  }, [architectureJson]);

  const prettyJson = useMemo(() => {
    if (!selectedArtifact?.content_json) {
      return null;
    }

    const normalized = normalizeJsonPayload(selectedArtifact.content_json);
    return JSON.stringify(normalized, null, 2);
  }, [selectedArtifact]);

  const runBuild = useCallback(async () => {
    if (!sessionId) {
      setBuildError("No active session");
      return;
    }

    setBuildLoading(true);
    setBuildError(null);

    const contextBlocks = [
      architectureArtifact?.content_md
        ? `Architecture artifact:\n${architectureArtifact.content_md.slice(0, 5_000)}`
        : "",
      latestAssistantMessage && latestAssistantMessage.role === "assistant"
        ? `Latest assistant response:\nSummary: ${latestAssistantMessage.content.summary}\nDecision: ${latestAssistantMessage.content.decision}\nNext actions: ${latestAssistantMessage.content.next_actions.join("; ")}`
        : ""
    ].filter(Boolean);

    try {
      const response = await runBuildWithVibe(sessionId, {
        goal: buildGoal.trim() ? buildGoal.trim() : undefined,
        context: contextBlocks.length > 0 ? contextBlocks.join("\n\n") : undefined,
        dry_run: buildDryRun
      });
      setBuildResult(response);
    } catch (error) {
      setBuildError(getErrorMessage(error));
    } finally {
      setBuildLoading(false);
    }
  }, [
    architectureArtifact,
    buildDryRun,
    buildGoal,
    latestAssistantMessage,
    sessionId
  ]);

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
              const isActive = item.panel === activePanel;
              const Icon = item.icon;

              return (
                <button
                  key={item.name}
                  type="button"
                  className={`sidebar-link ${isActive ? "sidebar-link-active" : ""}`}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => setActivePanel(item.panel)}
                >
                  <Icon className="sidebar-icon" size={18} />
                  {item.name}
                </button>
              );
            })}
          </nav>

          <div className="sidebar-footer">
            <span className="avatar">A</span>
            <p>Session {formatSessionId(sessionId)}</p>
          </div>
        </aside>

        <section className="chat-shell">
          <header className="chat-header" style={{ paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'flex-end' }}>
            <div className="topbar-actions" style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
              <label htmlFor="mode-select" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)' }}>
                Mode:
                <select
                  id="mode-select"
                  value={mode}
                  onChange={(event) => setMode(event.target.value as Mode)}
                  disabled={sessionLoading || isSending || buildLoading}
                  style={{ background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', padding: '0.3rem 0.6rem', borderRadius: '8px', fontSize: '0.85rem', outline: 'none' }}
                >
                  <option value="architect">Architect</option>
                  <option value="planner">Planner</option>
                  <option value="pitch">Pitch</option>
                </select>
              </label>

              <button
                className="button button-primary"
                onClick={() => void createNewSession()}
                disabled={sessionLoading || isSending || buildLoading}
                style={{ background: 'transparent', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                {sessionLoading ? "Creating..." : "New session"}
              </button>
            </div>
          </header>

          {(sessionError || requestError || speechError || buildError) && (
            <section className="status status-error">
              {sessionError && <p>Session error: {sessionError}</p>}
              {requestError && <p>Request error: {requestError}</p>}
              {speechError && <p>Voice output error: {speechError}</p>}
              {buildError && <p>Build error: {buildError}</p>}
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

          {activePanel === "chat" && (
            <>
              <section className="conversation" style={{ padding: 0, margin: 0, border: 'none', background: 'transparent', boxShadow: 'none' }}>
                <div className="message-stack">
                  {thread.map((message) => {
                    if (message.role === "user") {
                      return (
                        <article key={message.id} className="message message-user">
                          <p className="message-meta">You ({message.source})</p>
                          <p className="message-body">{message.content}</p>
                        </article>
                      );
                    }

                    const isSpeaking = speakingId === message.id;

                    return (
                      <article key={message.id} className="message message-assistant">
                        <div className="row spaced assistant-toolbar">
                          <p className="message-meta">Architect ({message.source})</p>
                          <button
                            className="button button-ghost"
                            onClick={() => void speakAssistant(message.id, message.content)}
                            disabled={isSpeaking || isSending}
                          >
                            {isSpeaking ? (
                              <>
                                <Loader2 size={14} className="spin" /> Generating Voice
                              </>
                            ) : (
                              <>
                                <Volume2 size={14} /> Speak
                              </>
                            )}
                          </button>
                        </div>
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
                      <p className="message-meta">Architect</p>
                      <p className="muted">Thinking...</p>
                    </article>
                  )}
                  <div ref={threadBottomRef} />
                </div>
              </section>

              {thread.length === 0 && (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                  {[
                    "Design a scalable microservices architecture for an e-commerce platform.",
                    "Define a serverless backend using AWS Lambda and API Gateway.",
                    "Plan an AI-powered data pipeline with real-time streaming."
                  ].map((suggestion, index) => (
                    <button
                      key={index}
                      onClick={() => void send("text", suggestion)}
                      disabled={!sessionId || isSending}
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: 'rgba(255,255,255,0.8)',
                        padding: '0.5rem 1rem',
                        borderRadius: '16px',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
                      onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}

              <section className="composer panel" style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', borderRadius: '20px', background: 'rgba(15,20,30,0.6)', border: '1px solid rgba(255,255,255,0.1)', marginTop: 'auto' }}>
                <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                  {(voice.isRecording || voice.fullTranscript) && (
                    <div style={{ fontSize: '0.85rem', color: '#8fb3df', background: 'rgba(14,25,45,0.6)', padding: '0.5rem 1rem', borderRadius: '8px', marginBottom: '0.5rem', border: '1px solid rgba(123,177,245,0.2)' }}>
                      <span style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem', marginRight: '0.25rem' }}>Transcript:</span>
                      {voice.fullTranscript || <span style={{ opacity: 0.5 }}>Listening...</span>}
                    </div>
                  )}

                  <textarea
                    id="text-message"
                    value={draftMessage}
                    onChange={(event) => setDraftMessage(event.target.value)}
                    placeholder="Message (↵ to send, Shift+↵ for line breaks...)"
                    rows={1}
                    disabled={!sessionId || isSending}
                    style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '0.95rem', resize: 'none', outline: 'none', minHeight: '44px', padding: '0.5rem 0' }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (draftMessage.trim() || voice.fullTranscript.trim()) {
                          if (voice.fullTranscript.trim() && !draftMessage.trim()) {
                            void send("voice", voice.fullTranscript);
                          } else {
                            void send("text", draftMessage);
                          }
                        }
                      }
                    }}
                  />

                  <div className="composer-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="composer-actions-left" style={{ display: 'flex', gap: '0.5rem' }}>
                      {voice.isRecording ? (
                        <button style={{ background: '#f45e52', color: '#fff', border: 'none', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} onClick={voice.stopRecording} aria-label="Stop Recording">
                          <Square size={14} fill="currentColor" />
                        </button>
                      ) : (
                        <button style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', border: 'none', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} onClick={() => void voice.startRecording()} disabled={!sessionId || isSending} aria-label="Use Voice">
                          <Mic size={16} />
                        </button>
                      )}

                      {voice.fullTranscript && (
                        <button style={{ background: 'transparent', color: 'rgba(255,255,255,0.5)', border: 'none', fontSize: '0.8rem', cursor: 'pointer' }} onClick={voice.clearTranscript} disabled={isSending}>
                          Clear
                        </button>
                      )}
                    </div>

                    <button
                      style={{ background: '#f45e52', color: '#fff', border: 'none', padding: '0.5rem 1rem', borderRadius: '12px', display: 'flex', gap: '0.4rem', alignItems: 'center', fontWeight: '600', fontSize: '0.9rem', cursor: 'pointer', opacity: (!sessionId || (!draftMessage.trim() && !voice.fullTranscript.trim()) || isSending) ? 0.5 : 1 }}
                      disabled={!sessionId || (!draftMessage.trim() && !voice.fullTranscript.trim()) || isSending}
                      onClick={() => {
                        if (voice.fullTranscript.trim() && !draftMessage.trim()) {
                          void send("voice", voice.fullTranscript);
                        } else {
                          void send("text", draftMessage);
                        }
                      }}
                    >
                      {isSending ? <Loader2 size={14} className="spin" /> : null}
                      Send
                    </button>
                  </div>
                </div>
              </section>


            </>
          )}

          {activePanel === "architecture" && (
            <section className="architecture-shell panel">
              <div className="row spaced">
                <h2>Architecture View</h2>
                <button
                  className="button"
                  onClick={() => sessionId && void loadArtifacts(sessionId)}
                  disabled={!sessionId || architectureLoading || artifactsLoading}
                >
                  {architectureLoading ? "Refreshing..." : "Refresh Architecture"}
                </button>
              </div>

              {architectureError && <p className="status-inline status-error">{architectureError}</p>}

              {!architectureArtifact && !architectureLoading && (
                <p className="muted">No architecture artifact available yet. Send a message from the Chat tab first.</p>
              )}

              {architectureArtifact && (
                <div className="architecture-grid">
                  <article className="architecture-card panel">
                    <h3>Diagram</h3>
                    {architectureDiagramUrl ? (
                      <img
                        src={architectureDiagramUrl}
                        alt="Architecture diagram"
                        className="architecture-diagram"
                      />
                    ) : (
                      <pre className="architecture-mermaid-fallback">{architectureMermaid ?? "No diagram available."}</pre>
                    )}
                  </article>

                  <article className="architecture-card panel">
                    <h3>Tech Stack</h3>
                    <ul className="stack-list">
                      {architectureStack.map((item) => (
                        <li key={item.key}>
                          <span>{item.key}</span>
                          <strong>{item.value}</strong>
                        </li>
                      ))}
                    </ul>
                  </article>

                  <article className="architecture-card panel architecture-markdown">
                    <h3>Architecture Markdown</h3>
                    <ReactMarkdown>{architectureArtifact.content_md || "_No architecture markdown available._"}</ReactMarkdown>
                  </article>
                </div>
              )}
            </section>
          )}

          {activePanel === "build" && (
            <section className="build-shell panel">
              <div className="row spaced">
                <h2>Build with Vibe</h2>
                <span className="muted">Runs Vibe CLI with current session context</span>
              </div>

              <label className="field" htmlFor="build-goal">
                Build Goal
                <textarea
                  id="build-goal"
                  value={buildGoal}
                  onChange={(event) => setBuildGoal(event.target.value)}
                  placeholder="Example: Scaffold initial feature files for this architecture and update README run steps."
                  rows={4}
                  disabled={!sessionId || buildLoading}
                />
              </label>

              <div className="row build-controls">
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={buildDryRun}
                    onChange={(event) => setBuildDryRun(event.target.checked)}
                    disabled={buildLoading}
                  />
                  Dry run (plan-only, no edits)
                </label>
                <button
                  className="button button-accent"
                  onClick={() => void runBuild()}
                  disabled={!sessionId || buildLoading}
                >
                  {buildLoading ? (
                    <>
                      <Loader2 size={14} className="spin" /> Running Vibe...
                    </>
                  ) : (
                    <>
                      <Play size={14} /> Run Build
                    </>
                  )}
                </button>
              </div>

              {buildResult && (
                <article className="build-result panel">
                  <div className="row spaced">
                    <h3>Build Result</h3>
                    <span className={`build-badge build-badge-${buildResult.status}`}>{buildResult.status}</span>
                  </div>
                  <p className="muted">
                    Duration: {(buildResult.duration_ms / 1000).toFixed(1)}s · Exit code: {String(buildResult.exit_code)}
                  </p>
                  <p className="muted"><strong>Command:</strong> {buildResult.command}</p>
                  <div className="build-output">
                    <pre>{buildResult.output || "No output returned."}</pre>
                  </div>
                  <ul className="build-notes">
                    {buildResult.notes.map((note, index) => (
                      <li key={`${note}-${index}`}>
                        <Sparkles size={14} /> {note}
                      </li>
                    ))}
                  </ul>
                </article>
              )}
            </section>
          )}
        </section>
      </section>
    </main>
  );
}
