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
  type Source,
  type TechStack
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
  Square,
  ClipboardList,
  Save,
  Wand2,
  Check,
  X,
  Plus,
  Trash2,
  AlertCircle,
  ChevronRight
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
  synthesizeVoice,
  getTechStack,
  updateTechStack,
  proposeTechStack
} from "@/lib/api";
import { useVoiceTranscript } from "@/hooks/useVoiceTranscript";
import { useSessionEvents } from "@/hooks/useSessionEvents";
import ArchitectureCanvas from "@/components/ArchitectureCanvas";

// Default behavior settings
const DEFAULT_MODE: Mode = "architect";

type WorkspacePanel = "chat" | "project-spec" | "architecture" | "build";

const sidebarItems: Array<{
  name: string;
  panel: WorkspacePanel;
  icon: React.ComponentType<{ className?: string; size?: number }>;
}> = [
    { name: "Chat", panel: "chat", icon: MessageSquare },
    { name: "Project Spec", panel: "project-spec", icon: ClipboardList },
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

const INITIAL_TECH_STACK: TechStack = {
  core: { language: "", framework: "", database: "" },
  data: { cache: "", broker: "", storage: "" },
  security: { auth: "", provider: "", gateway: "" },
  services: { observability: "", external_apis: "" },
  custom: []
};

export default function HomePage() {
  // Voice Recording Hook (Logic is separated for cleanliness)
  const voice = useVoiceTranscript();
  const clearVoiceTranscript = voice.clearTranscript;

  // Ref used to automatically scroll to the bottom of the chat
  const threadBottomRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [activePanel, setActivePanel] = useState<WorkspacePanel>("chat");

  const [mode, setMode] = useState<Mode>(DEFAULT_MODE);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [requestError, setRequestError] = useState<string | null>(null);
  const [buildLogs, setBuildLogs] = useState<Array<{ agent: string; data: string; timestamp: number }>>([]);
  const [buildStartTime, setBuildStartTime] = useState<number | null>(null);
  const [buildLoading, setBuildLoading] = useState(false);

  // Documents (Artifacts) state
  const [artifacts, setArtifacts] = useState<ArtifactListItem[]>([]);
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  const [artifactsError, setArtifactsError] = useState<string | null>(null);
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactDetail | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);

  const [architectureArtifact, setArchitectureArtifact] = useState<ArtifactDetail | null>(null);
  const [architectureLoading, setArchitectureLoading] = useState(false);
  const [architectureError, setArchitectureError] = useState<string | null>(null);
  const [showArchitectureMarkdown, setShowArchitectureMarkdown] = useState(false);

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

  const sessionCallbacks = useMemo(() => ({
    onArtifactReady: (kind: string) => {
      console.log(`Real-time update: Artifact of kind "${kind}" is ready.`);
      if (sessionId) {
        void loadArtifacts(sessionId);
      }
    },
    onJobFailed: (error: string) => {
      console.error("Real-time update: Job failed:", error);
      setRequestError(`Background job failed: ${error}`);
    },
    onBuildLog: (agent: string, data: string) => {
      setBuildLogs((prev) => [...prev, { agent, data, timestamp: Date.now() }]);
    },
    onBuildStart: (turbo: boolean) => {
      setBuildLogs([]);
      setBuildStartTime(Date.now());
    },
    onBuildDone: () => {
      setBuildLoading(false);
    }
  }), [sessionId, loadArtifacts]);

  useSessionEvents(sessionId, sessionCallbacks);

  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [draftMessage, setDraftMessage] = useState("");
  const [isSending, setIsSending] = useState(false);

  // Project Spec (Technical Manifest) State
  const [projectSpec, setProjectSpec] = useState<TechStack>(INITIAL_TECH_STACK);
  const [specSaving, setSpecSpecSaving] = useState(false);
  const [specLoading, setSpecLoading] = useState(false);
  const [specProposing, setSpecProposing] = useState(false);
  const [proposals, setProposals] = useState<TechStack | null>(null);
  const [showProposalModal, setShowProposalModal] = useState(false);
  const [acceptedProposals, setAcceptedProposals] = useState<Record<string, boolean>>({});

  // The actual list of messages shown in the UI
  const [thread, setThread] = useState<ThreadMessage[]>([]);

  const [architectureGenerating, setArchitectureGenerating] = useState(false);

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

  const nextActionChips = useMemo(() => {
    if (latestAssistantMessage?.role === "assistant") {
      return latestAssistantMessage.content.next_actions;
    }
    return [];
  }, [latestAssistantMessage]);

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

  const loadTechStack = useCallback(async (id: string) => {
    setSpecLoading(true);
    try {
      const response = await getTechStack(id);
      if (response.tech_stack) {
        setProjectSpec(response.tech_stack);
      } else {
        setProjectSpec(INITIAL_TECH_STACK);
      }
    } catch {
      // Failed to load tech stack
    } finally {
      setSpecLoading(false);
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
      setProjectSpec(INITIAL_TECH_STACK);
      clearVoiceTranscript();
    } catch (error) {
      setSessionError(getErrorMessage(error));
    } finally {
      setSessionLoading(false);
    }
  }, [clearVoiceTranscript, mode]);

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
    void loadTechStack(sessionId);
  }, [loadArtifacts, loadBlueprint, loadTechStack, sessionId]);

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

  const handleSaveTechStack = useCallback(async () => {
    if (!sessionId) return;
    setSpecSpecSaving(true);
    try {
      await updateTechStack(sessionId, { tech_stack: projectSpec });
    } catch (error) {
      setRequestError(getErrorMessage(error));
    } finally {
      setSpecSpecSaving(false);
    }
  }, [sessionId, projectSpec]);

  const handleProposeTechStack = useCallback(async () => {
    if (!sessionId) return;
    setSpecProposing(true);
    try {
      const response = await proposeTechStack(sessionId);
      setProposals(response.proposals);
      
      // Reset accepted state
      const initialAccepted: Record<string, boolean> = {};
      const checkDifferences = (obj1: any, obj2: any, prefix = "") => {
        for (const key in obj2) {
          const path = prefix ? `${prefix}.${key}` : key;
          if (typeof obj2[key] === 'object' && !Array.isArray(obj2[key])) {
            checkDifferences(obj1[key], obj2[key], path);
          } else if (JSON.stringify(obj1[key]) !== JSON.stringify(obj2[key])) {
            initialAccepted[path] = true;
          }
        }
      };
      checkDifferences(projectSpec, response.proposals);
      setAcceptedProposals(initialAccepted);
      setShowProposalModal(true);
    } catch (error) {
      setRequestError(getErrorMessage(error));
    } finally {
      setSpecProposing(false);
    }
  }, [sessionId, projectSpec]);

  const applyProposals = useCallback(() => {
    if (!proposals) return;
    
    setProjectSpec(current => {
      const next = JSON.parse(JSON.stringify(current)) as TechStack;
      
      const merge = (target: any, source: any, prefix = "") => {
        for (const key in source) {
          const path = prefix ? `${prefix}.${key}` : key;
          if (typeof source[key] === 'object' && !Array.isArray(source[key])) {
            merge(target[key], source[key], path);
          } else if (acceptedProposals[path]) {
            target[key] = source[key];
          }
        }
      };
      
      merge(next, proposals);
      return next;
    });
    
    setShowProposalModal(false);
    setProposals(null);
  }, [acceptedProposals, proposals]);

  const updateCustomField = (index: number, key: string, value: string) => {
    setProjectSpec(prev => {
      const next = { ...prev };
      next.custom[index] = { key, value };
      return next;
    });
  };

  const addCustomField = () => {
    setProjectSpec(prev => ({
      ...prev,
      custom: [...prev.custom, { key: "", value: "" }]
    }));
  };

  const removeCustomField = (index: number) => {
    setProjectSpec(prev => ({
      ...prev,
      custom: prev.custom.filter((_, i) => i !== index)
    }));
  };

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
          </div>

          <nav className="sidebar-nav" aria-label="Primary">
            <div className="sidebar-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {sidebarItems.map((item) => {
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
                          lineHeight: 1.6,
                          fontSize: '0.95rem',
                          textAlign: 'left'
                        }}>
                          <ReactMarkdown className="chat-markdown">
                            {isUser ? message.content : message.content.summary}
                          </ReactMarkdown>
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

                <section className="composer" style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', borderRadius: '20px', background: 'rgba(15,20,30,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}>
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

          {activePanel === "project-spec" && (
            <section className="panel" style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1.5rem", padding: "2rem", margin: "0 auto", width: "100%", overflowY: "auto", position: 'relative' }}>
              {specLoading && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
                  <Loader2 size={32} className="spin text-accent" />
                </div>
              )}
              
              <div className="row spaced" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                    <ClipboardList size={24} style={{ color: '#63f0d2' }} />
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Technical Manifest</h2>
                  </div>
                  <p className="muted" style={{ fontSize: '0.85rem' }}>The single source of truth for your architecture foundation.</p>
                </div>
                
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button 
                    className="button button-ghost" 
                    onClick={handleProposeTechStack}
                    disabled={specProposing || isSending}
                    style={{ background: 'rgba(99,240,210,0.05)', color: '#63f0d2', border: '1px solid rgba(99,240,210,0.2)' }}
                  >
                    {specProposing ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}
                    Propose from Chat
                  </button>
                  <button 
                    className="button button-accent" 
                    onClick={handleSaveTechStack}
                    disabled={specSaving}
                  >
                    {specSaving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                    {specSaving ? "Saving..." : "Save Manifest"}
                  </button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', marginTop: '1rem' }}>
                {/* Core Foundation */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '1.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <h3 style={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', color: '#62b7ff', letterSpacing: '0.05em' }}>Core Foundation</h3>
                  {[
                    { label: 'Language & Runtime', key: 'language', section: 'core' },
                    { label: 'Primary Framework', key: 'framework', section: 'core' },
                    { label: 'Primary Database', key: 'database', section: 'core' }
                  ].map(field => (
                    <div key={field.key}>
                      <label style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: '0.4rem' }}>{field.label}</label>
                      <input
                        type="text"
                        value={(projectSpec as any)[field.section][field.key]}
                        onChange={(e) => setProjectSpec(prev => {
                          const next = { ...prev };
                          (next as any)[field.section][field.key] = e.target.value;
                          return next;
                        })}
                        placeholder="Not specified"
                        style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '0.9rem', padding: '0.6rem 0.8rem', outline: 'none' }}
                      />
                    </div>
                  ))}
                </div>

                {/* Data Layer */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '1.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <h3 style={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', color: '#7f7dff', letterSpacing: '0.05em' }}>Data Layer</h3>
                  {[
                    { label: 'Caching & State', key: 'cache', section: 'data' },
                    { label: 'Message Broker', key: 'broker', section: 'data' },
                    { label: 'Cloud Storage', key: 'storage', section: 'data' }
                  ].map(field => (
                    <div key={field.key}>
                      <label style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: '0.4rem' }}>{field.label}</label>
                      <input
                        type="text"
                        value={(projectSpec as any)[field.section][field.key]}
                        onChange={(e) => setProjectSpec(prev => {
                          const next = { ...prev };
                          (next as any)[field.section][field.key] = e.target.value;
                          return next;
                        })}
                        placeholder="Not specified"
                        style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '0.9rem', padding: '0.6rem 0.8rem', outline: 'none' }}
                      />
                    </div>
                  ))}
                </div>

                {/* Security & Infra */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '1.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <h3 style={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', color: '#f68279', letterSpacing: '0.05em' }}>Security & Infra</h3>
                  {[
                    { label: 'Authentication', key: 'auth', section: 'security' },
                    { label: 'Cloud Provider', key: 'provider', section: 'security' },
                    { label: 'API Gateway/CDN', key: 'gateway', section: 'security' }
                  ].map(field => (
                    <div key={field.key}>
                      <label style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: '0.4rem' }}>{field.label}</label>
                      <input
                        type="text"
                        value={(projectSpec as any)[field.section][field.key]}
                        onChange={(e) => setProjectSpec(prev => {
                          const next = { ...prev };
                          (next as any)[field.section][field.key] = e.target.value;
                          return next;
                        })}
                        placeholder="Not specified"
                        style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '0.9rem', padding: '0.6rem 0.8rem', outline: 'none' }}
                      />
                    </div>
                  ))}
                </div>

                {/* Observability & Services */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '1.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <h3 style={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', color: '#63f0d2', letterSpacing: '0.05em' }}>Services</h3>
                  {[
                    { label: 'Logging/Monitoring', key: 'observability', section: 'services' },
                    { label: 'External APIs', key: 'external_apis', section: 'services' }
                  ].map(field => (
                    <div key={field.key}>
                      <label style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: '0.4rem' }}>{field.label}</label>
                      <input
                        type="text"
                        value={(projectSpec as any)[field.section][field.key]}
                        onChange={(e) => setProjectSpec(prev => {
                          const next = { ...prev };
                          (next as any)[field.section][field.key] = e.target.value;
                          return next;
                        })}
                        placeholder="Not specified"
                        style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '0.9rem', padding: '0.6rem 0.8rem', outline: 'none' }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Custom Fields */}
              <div style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)', marginTop: '1rem' }}>
                <div className="row spaced" style={{ marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', letterSpacing: '0.05em' }}>Custom Requirements</h3>
                  <button className="button button-ghost" onClick={addCustomField} style={{ fontSize: '0.7rem', padding: '0.2rem 0.6rem' }}>
                    <Plus size={12} /> Add Field
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
                  {projectSpec.custom.map((field, index) => (
                    <div key={index} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                      <div style={{ flex: 1 }}>
                        <input
                          type="text"
                          value={field.key}
                          onChange={(e) => updateCustomField(index, e.target.value, field.value)}
                          placeholder="Key"
                          style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px 8px 0 0', color: '#fff', fontSize: '0.8rem', padding: '0.4rem 0.6rem', outline: 'none' }}
                        />
                        <input
                          type="text"
                          value={field.value}
                          onChange={(e) => updateCustomField(index, field.key, e.target.value)}
                          placeholder="Value"
                          style={{ width: '100%', background: 'rgba(0,0,0,0.1)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '0 0 8px 8px', color: '#fff', fontSize: '0.8rem', padding: '0.4rem 0.6rem', outline: 'none' }}
                        />
                      </div>
                      <button className="button button-ghost" onClick={() => removeCustomField(index)} style={{ padding: '0.5rem', color: '#f45e52' }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </section>
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

      {/* Review Proposal Modal */}
      {showProposalModal && proposals && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '2rem' }}>
          <div style={{ background: '#0a0c12', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '28px', width: '100%', maxWidth: '1000px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 48px 96px rgba(0,0,0,0.8)' }}>
            <div style={{ padding: '2rem 2.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <Wand2 size={24} style={{ color: '#63f0d2' }} />
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Review AI Recommendations</h2>
                </div>
                <p className="muted" style={{ fontSize: '0.9rem', marginTop: '0.4rem' }}>The Architect has analyzed your conversation. Review and merge the findings.</p>
              </div>
              <button onClick={() => setShowProposalModal(false)} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', padding: '0.5rem', borderRadius: '50%' }}>
                <X size={24} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '2.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: '1.5rem', marginBottom: '1.5rem', padding: '0 1.5rem', opacity: 0.5 }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Category</span>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Current Value</span>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em' }}>AI Suggestion</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>
                {[
                  { key: 'core', label: 'Core Foundation', color: '#62b7ff' },
                  { key: 'data', label: 'Data Layer', color: '#7f7dff' },
                  { key: 'security', label: 'Security & Infra', color: '#f68279' },
                  { key: 'services', label: 'Services', color: '#63f0d2' }
                ].map(section => (
                  <div key={section.key}>
                    <h3 style={{ fontSize: '0.8rem', fontWeight: 900, textTransform: 'uppercase', color: section.color, letterSpacing: '0.1em', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ width: '4px', height: '12px', background: section.color, borderRadius: '2px' }} />
                      {section.label}
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {Object.keys((proposals as any)[section.key]).map(fieldKey => {
                        const path = `${section.key}.${fieldKey}`;
                        const currentValue = (projectSpec as any)[section.key][fieldKey];
                        const proposedValue = (proposals as any)[section.key][fieldKey];
                        const isDifferent = proposedValue && (currentValue !== proposedValue);
                        const isAccepted = acceptedProposals[path];

                        if (!proposedValue) return null;

                        return (
                          <div 
                            key={fieldKey} 
                            onClick={() => setAcceptedProposals(prev => ({ ...prev, [path]: !prev[path] }))}
                            style={{ 
                              display: 'grid', 
                              gridTemplateColumns: '1fr 1fr 1.2fr', 
                              gap: '1.5rem', 
                              padding: '1.25rem 1.5rem', 
                              background: isAccepted ? 'rgba(99,240,210,0.08)' : isDifferent ? 'rgba(255,165,0,0.04)' : 'rgba(255,255,255,0.02)', 
                              borderRadius: '16px', 
                              border: isAccepted ? '1px solid rgba(99,240,210,0.4)' : isDifferent ? '1px solid rgba(255,165,0,0.2)' : '1px solid rgba(255,255,255,0.05)',
                              cursor: 'pointer',
                              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                              alignItems: 'center',
                              position: 'relative'
                            }}
                          >
                            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'rgba(255,255,255,0.8)' }}>{fieldKey.charAt(0).toUpperCase() + fieldKey.slice(1).replace('_', ' ')}</div>
                            <div style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.4)', fontStyle: !currentValue ? 'italic' : 'normal' }}>{currentValue || 'Not set'}</div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                {isDifferent && <ChevronRight size={14} style={{ color: '#63f0d2' }} />}
                                <div style={{ fontSize: '0.95rem', color: isDifferent ? '#63f0d2' : '#fff', fontWeight: isDifferent ? 800 : 400 }}>{proposedValue}</div>
                              </div>
                              <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: isAccepted ? '#63f0d2' : 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: isAccepted ? 'none' : '1px solid rgba(255,255,255,0.1)' }}>
                                {isAccepted && <Check size={14} color="#0a0c12" strokeWidth={3} />}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ padding: '2rem 2.5rem', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'flex-end', gap: '1.25rem', background: 'rgba(255,255,255,0.02)', borderRadius: '0 0 28px 28px' }}>
              <button className="button button-ghost" onClick={() => setShowProposalModal(false)} style={{ padding: '0.75rem 1.5rem' }}>Discard Changes</button>
              <button className="button button-accent" onClick={applyProposals} style={{ padding: '0.75rem 2rem', fontSize: '1rem' }}>Apply Selected Changes</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
