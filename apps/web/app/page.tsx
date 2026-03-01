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
  type BlueprintJson,
  type Mode,
  type RunBuildResponse,
  type SavedNodePosition,
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
  generateBlueprint,
  getBlueprint,
  getArtifact,
  getArtifacts,
  runBuildWithVibe,
  saveLayout,
  sendMessage,
  synthesizeVoice
} from "@/lib/api";
import { useVoiceTranscript } from "@/hooks/useVoiceTranscript";
import { useSessionEvents } from "@/hooks/useSessionEvents";
import ArchitectureCanvas from "@/components/ArchitectureCanvas";

// Default behavior settings
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export default function HomePage() {
  // Voice Recording Hook (Logic is separated for cleanliness)
  const voice = useVoiceTranscript();
  const clearVoiceTranscript = voice.clearTranscript;

  // Ref used to automatically scroll to the bottom of the chat
  const threadBottomRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [activePanel, setActivePanel] = useState<WorkspacePanel>("chat");

  /**
   * React State Management
   * Problem: React needs to "remember" things like the current session ID
   * and the messages in the chat.
   * Solution: Use 'useState' hooks to track these values.
   */
  const [mode, setMode] = useState<Mode>(DEFAULT_MODE);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useSessionEvents(sessionId, {
    onArtifactReady: (kind) => {
      console.log(`Real-time update: Artifact of kind "${kind}" is ready.`);
      if (sessionId) {
        void loadArtifacts(sessionId);
      }
    },
    onJobFailed: (error) => {
      console.error("Real-time update: Job failed:", error);
      setRequestError(`Background job failed: ${error}`);
    },
    onBuildLog: (agent, data) => {
      setBuildLogs((prev) => [...prev, { agent, data, timestamp: Date.now() }]);
    },
    onBuildStart: (turbo) => {
      setBuildLogs([]);
      setBuildStartTime(Date.now());
    },
    onBuildDone: () => {
      setBuildLoading(false);
    }
  });
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [draftMessage, setDraftMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  // Project Spec State
  const [projectSpec, setProjectSpec] = useState({
    backend: "",
    frontend: "",
    database: "",
    other: ""
  });

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
  const [architectureArtifact, setArchitectureArtifact] = useState<ArtifactDetail | null>(null);
  const [architectureLoading, setArchitectureLoading] = useState(false);
  const [architectureError, setArchitectureError] = useState<string | null>(null);
  const [architectureGenerating, setArchitectureGenerating] = useState(false);
  const [showArchitectureMarkdown, setShowArchitectureMarkdown] = useState(false);

  // Blueprint (React Flow) state
  const [blueprintJson, setBlueprintJson] = useState<BlueprintJson | null>(null);
  const [blueprintReadme, setBlueprintReadme] = useState<string>("");
  const [savedPositions, setSavedPositions] = useState<SavedNodePosition[]>([]);
  const [blueprintGenerating, setBlueprintGenerating] = useState(false);
  const [blueprintError, setBlueprintError] = useState<string | null>(null);
  const [layoutSaving, setLayoutSaving] = useState(false);

  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);

  const [buildGoal, setBuildGoal] = useState("");
  const [buildDryRun, setBuildDryRun] = useState(false);
  const [turboMode, setTurboMode] = useState(false);
  const [buildLoading, setBuildLoading] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [buildResult, setBuildResult] = useState<RunBuildResponse | null>(null);
  const [buildLogs, setBuildLogs] = useState<Array<{ agent: string; data: string; timestamp: number }>>([]);
  const [buildStartTime, setBuildStartTime] = useState<number | null>(null);

  const latestAssistantMessage = useMemo(() => {
    for (let index = thread.length - 1; index >= 0; index -= 1) {
      const item = thread[index];
      if (item.role === "assistant") {
        return item;
      }
    }

    return null;
  }, [thread]);

  const nextActionChips = useMemo(() => {
    if (latestAssistantMessage?.role === "assistant") {
      return latestAssistantMessage.content.next_actions;
    }
    return [];
  }, [latestAssistantMessage]);

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
      setShowArchitectureMarkdown(false);
      if (!selectedArtifact || selectedArtifact.id === latestArchitectureItem.id) {
        setSelectedArtifact(detail);
      }
    } catch (error) {
      setArchitectureError(getErrorMessage(error));
    } finally {
      setArchitectureLoading(false);
    }
  }, [selectedArtifact]);

  const loadBlueprint = useCallback(async (id: string) => {
    try {
      const bp = await getBlueprint(id);
      setBlueprintJson(bp.blueprint_json);
      setBlueprintReadme(bp.readme_md);
      setSavedPositions(bp.saved_positions);
    } catch {
      // Blueprint not yet generated, that's fine
    }
  }, []);

  const createNewSession = useCallback(async () => {
    setSessionLoading(true);
    setSessionError(null);

    try {
      const response = await createSession({ mode });
      setSessionId(response.id);
      // Reset UI state for the new session
      setArtifacts([]);
      setSelectedArtifact(null);
      setArchitectureArtifact(null);
      setArchitectureError(null);
      setShowArchitectureMarkdown(false);
      setBlueprintJson(null);
      setBlueprintReadme("");
      setSavedPositions([]);
      setBlueprintError(null);
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

  /**
   * Action: Load the list of documents for the current session.
   */
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
    void loadBlueprint(sessionId);
  }, [loadArtifacts, loadBlueprint, sessionId]);

  /**
   * Effect: Keep the chat scrolled to the bottom.
   */
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
        // Prepare context-aware content including current project spec
        const specSummary = `Current Project Spec: Backend=${projectSpec.backend || "?"}, Frontend=${projectSpec.frontend || "?"}, Database=${projectSpec.database || "?"}, Other=${projectSpec.other || "None"}`;
        const contextualContent = `[${specSummary}]\n\n${content}`;

        // Send to API
        const response = await sendMessage(sessionId, { content: contextualContent, source });

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
    [clearVoiceTranscript, loadArtifacts, sessionId, projectSpec]
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
      if (detail.kind === "architecture") {
        setArchitectureArtifact(detail);
      }
    } catch (error) {
      setArtifactError(getErrorMessage(error));
    } finally {
      setArtifactLoading(false);
    }
  }, []);

  /**
   * Memoized Value: Format the JSON for pretty display.
   */
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

  const architectureSummary = useMemo(() => {
    if (architectureJson && typeof architectureJson === "object" && "summary" in architectureJson) {
      const summary = (architectureJson as { summary?: unknown }).summary;
      if (typeof summary === "string" && summary.trim()) {
        return summary.trim();
      }
    }

    return architectureArtifact ? "Architecture generated from latest chat context." : "";
  }, [architectureArtifact, architectureJson]);

  const architectureDecision = useMemo(() => {
    if (architectureJson && typeof architectureJson === "object" && "decision" in architectureJson) {
      const decision = (architectureJson as { decision?: unknown }).decision;
      if (typeof decision === "string" && decision.trim()) {
        return decision.trim();
      }
    }

    return "";
  }, [architectureJson]);

  const architectureNextActions = useMemo(() => {
    if (architectureJson && typeof architectureJson === "object" && "next_actions" in architectureJson) {
      const next = (architectureJson as { next_actions?: unknown }).next_actions;
      if (Array.isArray(next)) {
        return next.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
      }
    }

    return [] as string[];
  }, [architectureJson]);

  const architectureJsonPreview = useMemo(() => {
    const serialized = JSON.stringify(architectureJson ?? {}, null, 2);
    const maxLength = 2_200;
    return serialized.length > maxLength ? `${serialized.slice(0, maxLength)}\n...` : serialized;
  }, [architectureJson]);

  const prettyJson = useMemo(() => {
    if (!selectedArtifact?.content_json) {
      return null;
    }

    const normalized = normalizeJsonPayload(selectedArtifact.content_json);
    return JSON.stringify(normalized, null, 2);
  }, [selectedArtifact]);

  const handleGenerateBlueprint = useCallback(async () => {
    if (!sessionId) {
      setBlueprintError("No active session");
      return;
    }

    setBlueprintGenerating(true);
    setBlueprintError(null);

    try {
      const bp = await generateBlueprint(sessionId);
      setBlueprintJson(bp.blueprint_json);
      setBlueprintReadme(bp.readme_md);
      setSavedPositions(bp.saved_positions);
      // Also refresh artifacts list
      await loadArtifacts(sessionId);
    } catch (error) {
      setBlueprintError(getErrorMessage(error));
    } finally {
      setBlueprintGenerating(false);
    }
  }, [sessionId, loadArtifacts]);

  const handleSaveLayout = useCallback(async (positions: SavedNodePosition[]) => {
    if (!sessionId) return;
    setLayoutSaving(true);
    try {
      await saveLayout(sessionId, { positions });
      setSavedPositions(positions);
    } catch (error) {
      setBlueprintError(getErrorMessage(error));
    } finally {
      setLayoutSaving(false);
    }
  }, [sessionId]);

  const generateArchitecture = useCallback(async () => {
    if (!sessionId) {
      setArchitectureError("No active session");
      return;
    }

    setArchitectureGenerating(true);
    setArchitectureError(null);
    const previousArtifactId = architectureArtifact?.id ?? null;

    try {
      // Use the blueprint generation endpoint directly
      await handleGenerateBlueprint();

      let refreshed = false;
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const list = await getArtifacts(sessionId);
        setArtifacts(list);
        const latestArchitecture = list.find((item) => item.kind === "architecture");

        if (latestArchitecture && latestArchitecture.id !== previousArtifactId) {
          await loadLatestArchitecture(sessionId, list);
          refreshed = true;
          break;
        }

        await sleep(800);
      }

      if (!refreshed) {
        await loadArtifacts(sessionId);
      }
    } catch (error) {
      setArchitectureError(getErrorMessage(error));
    } finally {
      setArchitectureGenerating(false);
    }
  }, [
    architectureArtifact?.id,
    handleGenerateBlueprint,
    loadArtifacts,
    loadLatestArchitecture,
    sessionId
  ]);

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
        dry_run: buildDryRun,
        turbo: turboMode
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
    sessionId,
    turboMode
  ]);

  return (
    <main className="chat-app">
      <section className="workspace-shell">
        {/* Sidebar: Navigation and Branding */}
        <aside className="sidebar">
          <div className="sidebar-brand">
            <h2 className="brand-title">
              <span className="brand-icon">*</span>
              The Architect
            </h2>
            <p className="kicker">AI Co-founder Workspace</p>
          </div>

          <nav className="sidebar-nav" aria-label="Primary">
            <div className="sidebar-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {sidebarItems.slice(0, 1).map((item) => {
                const isActive = item.panel === activePanel;
                const Icon = item.icon;
                return (
                  <button
                    key={item.name}
                    type="button"
                    className={`sidebar-link ${isActive ? "sidebar-link-active" : ""}`}
                    onClick={() => setActivePanel(item.panel)}
                  >
                    <Icon className="sidebar-icon" size={18} />
                    {item.name}
                  </button>
                );
              })}
            </div>

            {/* Project Spec Section */}
            <div className="project-spec-panel" style={{ margin: '1.5rem 0.75rem', padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
              <h3 style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05rem', color: 'rgba(255,255,255,0.4)', marginBottom: '0.75rem', fontWeight: 700 }}>Project Spec</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                {[
                  { label: 'Backend', key: 'backend', placeholder: 'e.g. Go, Rust' },
                  { label: 'Frontend', key: 'frontend', placeholder: 'e.g. React, Vue' },
                  { label: 'Database', key: 'database', placeholder: 'e.g. Postgres' }
                ].map((field) => (
                  <div key={field.key}>
                    <label style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', display: 'block', marginBottom: '0.2rem' }}>{field.label}</label>
                    <input
                      type="text"
                      value={projectSpec[field.key as keyof typeof projectSpec]}
                      onChange={(e) => setProjectSpec(prev => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '0.8rem', padding: '0.2rem 0', outline: 'none' }}
                    />
                  </div>
                ))}
                <div>
                  <label style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', display: 'block', marginBottom: '0.2rem' }}>Other</label>
                  <textarea
                    value={projectSpec.other}
                    onChange={(e) => setProjectSpec(prev => ({ ...prev, other: e.target.value }))}
                    placeholder="Auth, Cloud, etc..."
                    rows={2}
                    style={{ width: '100%', background: 'transparent', border: 'none', color: '#fff', fontSize: '0.8rem', outline: 'none', resize: 'none' }}
                  />
                </div>
              </div>
            </div>

            <div className="sidebar-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {sidebarItems.slice(1).map((item) => {
                const isActive = item.panel === activePanel;
                const Icon = item.icon;
                return (
                  <button
                    key={item.name}
                    type="button"
                    className={`sidebar-link ${isActive ? "sidebar-link-active" : ""}`}
                    onClick={() => setActivePanel(item.panel)}
                  >
                    <Icon className="sidebar-icon" size={18} />
                    {item.name}
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="sidebar-footer">
            <span className="avatar">A</span>
            <p>Session {formatSessionId(sessionId)}</p>
          </div>
        </aside>

        {/* Main Chat Area */}
        <section className="chat-shell">
          <header className="chat-header" style={{ paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'flex-end' }}>
            <div className="topbar-actions" style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                Mode: <strong style={{ color: '#63f0d2' }}>Architect</strong>
              </span>

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

          {/* Error Notifications */}
          {(sessionError || requestError || speechError || buildError) && (
            <section className="status status-error">
              {sessionError && <p>Session error: {sessionError}</p>}
              {requestError && <p>Request error: {requestError}</p>}
              {speechError && <p>Voice output error: {speechError}</p>}
              {buildError && <p>Build error: {buildError}</p>}
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

          {activePanel === "chat" && (
            <>
              <section className="conversation" style={{ padding: '1rem', margin: 0, border: 'none', background: 'transparent', boxShadow: 'none', flex: 1, overflowY: 'auto' }}>
                <div className="message-stack" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  {thread.map((message) => {
                    const isUser = message.role === "user";
                    return (
                      <article 
                        key={message.id} 
                        className={`message ${isUser ? 'message-user' : 'message-assistant'}`}
                        style={{
                          alignSelf: isUser ? 'flex-end' : 'flex-start',
                          maxWidth: '80%',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.4rem'
                        }}
                      >
                        <p style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', textAlign: isUser ? 'right' : 'left', padding: '0 0.5rem' }}>
                          {isUser ? 'You' : 'Architect'}
                        </p>
                        <div style={{
                          background: isUser ? '#f45e52' : 'rgba(255,255,255,0.05)',
                          color: '#fff',
                          padding: '0.8rem 1.2rem',
                          borderRadius: isUser ? '20px 20px 4px 20px' : '20px 20px 20px 4px',
                          border: isUser ? 'none' : '1px solid rgba(255,255,255,0.1)',
                          lineHeight: 1.5,
                          fontSize: '0.95rem'
                        }}>
                          {isUser ? message.content : message.content.summary}
                        </div>
                        {!isUser && (
                           <button
                            onClick={() => void speakAssistant(message.id, message.content)}
                            style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: '0.7rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0 0.5rem' }}
                           >
                             <Volume2 size={12} /> {speakingId === message.id ? 'Generating...' : 'Speak'}
                           </button>
                        )}
                      </article>
                    );
                  })}

                  {isSending && (
                    <div style={{ alignSelf: 'flex-start', background: 'rgba(255,255,255,0.03)', padding: '0.8rem 1.2rem', borderRadius: '20px', fontSize: '0.9rem', color: 'rgba(255,255,255,0.4)' }}>
                      Architect is thinking...
                    </div>
                  )}
                  <div ref={threadBottomRef} />
                </div>
              </section>

              {/* Chips and Composer */}
              <div style={{ padding: '1rem', marginTop: 'auto' }}>
                {nextActionChips.length > 0 && !isSending && (
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem', justifyContent: 'center' }}>
                    {nextActionChips.map((chip, index) => (
                      <button
                        key={index}
                        onClick={() => void send("text", chip)}
                        style={{
                          background: 'rgba(99,240,210,0.1)',
                          border: '1px solid rgba(99,240,210,0.3)',
                          color: '#63f0d2',
                          padding: '0.4rem 1rem',
                          borderRadius: '20px',
                          fontSize: '0.8rem',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                        }}
                        onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(99,240,210,0.2)' }}
                        onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(99,240,210,0.1)' }}
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                )}

                {thread.length === 0 && (
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem', justifyContent: 'center' }}>
                    {[
                      "Hi Architect, can you help me build a new app?",
                      "I want to design a microservices system.",
                      "What's the best tech stack for a real-time chat?"
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
                        }}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}

                <section className="composer panel" style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', borderRadius: '20px', background: 'rgba(15,20,30,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}>
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
            </div>
          </>
        )}

          {activePanel === "architecture" && (
            <section style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.75rem", minHeight: 0 }}>
              <div className="row spaced">
                <h2>Architecture Canvas</h2>
                <div className="row architecture-actions">
                  <button
                    className="button button-accent"
                    onClick={() => void handleGenerateBlueprint()}
                    disabled={!sessionId || blueprintGenerating || isSending}
                  >
                    {blueprintGenerating ? (
                      <><Loader2 size={14} className="spin" /> Generating Blueprint...</>
                    ) : (
                      blueprintJson ? "Update Blueprint" : "Generate Blueprint"
                    )}
                  </button>
                  <button
                    className="button"
                    onClick={() => sessionId && void loadBlueprint(sessionId)}
                    disabled={!sessionId || blueprintGenerating}
                  >
                    Refresh
                  </button>
                  {blueprintReadme && (
                    <button
                      className="button button-ghost"
                      onClick={() => setShowArchitectureMarkdown((c) => !c)}
                    >
                      {showArchitectureMarkdown ? "Hide README" : "Show README"}
                    </button>
                  )}
                </div>
              </div>

              {(blueprintError || architectureError) && (
                <p className="status-inline status-error">{blueprintError || architectureError}</p>
              )}

              {showArchitectureMarkdown && blueprintReadme && (
                <article className="panel" style={{ padding: "0.7rem", maxHeight: 240, overflow: "auto" }}>
                  <div className="architecture-markdown-body">
                    <ReactMarkdown>{blueprintReadme}</ReactMarkdown>
                  </div>
                </article>
              )}

              <div style={{ flex: 1, minHeight: 400 }}>
                <ArchitectureCanvas
                  blueprint={blueprintJson}
                  savedPositions={savedPositions}
                  onSaveLayout={handleSaveLayout}
                  saving={layoutSaving}
                />
              </div>
            </section>
          )}

          {activePanel === "build" && (
            <section className="build-shell panel" style={{ overflow: "auto" }}>
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
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <label className="checkbox-line">
                    <input
                      type="checkbox"
                      checked={buildDryRun}
                      onChange={(event) => setBuildDryRun(event.target.checked)}
                      disabled={buildLoading}
                    />
                    Dry run (plan-only, no edits)
                  </label>
                  <label className="checkbox-line" style={{ color: turboMode ? '#63f0d2' : 'inherit' }}>
                    <input
                      type="checkbox"
                      checked={turboMode}
                      onChange={(event) => setTurboMode(event.target.checked)}
                      disabled={buildLoading}
                    />
                    Turbo Mode (parallel agents)
                  </label>
                </div>
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

              {buildLogs.length > 0 && (
                <div className="build-logs panel" style={{ marginTop: '1rem', background: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', maxHeight: '400px', overflow: 'auto' }}>
                  <div className="row spaced" style={{ padding: '0.5rem', borderBottom: '1px solid #30363d', position: 'sticky', top: 0, background: '#0d1117' }}>
                    <h3 style={{ fontSize: '0.85rem', color: '#8b949e', margin: 0 }}>Build Logs</h3>
                    <button
                      className="button button-ghost"
                      style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                      onClick={() => setBuildLogs([])}
                    >
                      Clear
                    </button>
                  </div>
                  <div style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.8rem', lineHeight: 1.5 }}>
                    {buildLogs.map((log, index) => (
                      <div key={index} style={{ color: log.agent === 'Vibe' ? '#e6edf3' : log.agent === 'Agent 1' ? '#7ee787' : log.agent === 'Agent 2' ? '#79c0ff' : log.agent === 'Agent 3' ? '#d2a8ff' : log.agent === 'Agent 4' ? '#ffa657' : '#8b949e' }}>
                        <span style={{ opacity: 0.6 }}>[{log.agent}]</span> {log.data}
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
