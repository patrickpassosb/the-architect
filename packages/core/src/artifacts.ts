import { randomUUID } from "node:crypto";
import type {
  ArtifactGenerationJobPayload,
  ArtifactKind
} from "@the-architect/shared-types";

export type GeneratedArtifact = {
  id: string;
  session_id: string;
  kind: ArtifactKind;
  title: string;
  content_md: string;
  content_json: string;
};

type ArchitectureStack = {
  frontend: string;
  api: string;
  queue: string;
  worker: string;
  database: string;
  ai: string;
};

type ArchitectureProfile = "microservices" | "serverless" | "realtime" | "default";

function modeTitle(kind: ArtifactKind) {
  if (kind === "architecture") return "Architecture Draft";
  if (kind === "tasks") return "Task Plan";
  return "Pitch Pack";
}

function readMetadataString(payload: ArtifactGenerationJobPayload, key: string): string {
  const metadata = payload.context.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return "";
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function architectureContextBlob(payload: ArtifactGenerationJobPayload): string {
  const assistant = payload.context.assistant;
  const chatContext = readMetadataString(payload, "chat_context");

  return [
    payload.context.user_input,
    assistant.summary,
    assistant.decision,
    assistant.next_actions.join("\n"),
    chatContext
  ]
    .join("\n")
    .toLowerCase();
}

function inferArchitectureProfile(text: string): ArchitectureProfile {
  if (text.includes("serverless") || text.includes("lambda") || text.includes("api gateway")) {
    return "serverless";
  }

  if (
    text.includes("real-time") ||
    text.includes("realtime") ||
    text.includes("stream") ||
    text.includes("event-driven") ||
    text.includes("kafka")
  ) {
    return "realtime";
  }

  if (
    text.includes("microservice") ||
    text.includes("micro-service") ||
    text.includes("e-commerce") ||
    text.includes("marketplace")
  ) {
    return "microservices";
  }

  return "default";
}

function inferDomainServices(text: string): string[] {
  if (text.includes("e-commerce") || text.includes("marketplace") || text.includes("shop")) {
    return ["Auth", "Catalog", "Orders", "Payments"];
  }

  if (text.includes("fintech") || text.includes("bank") || text.includes("payment")) {
    return ["Auth", "Ledger", "Risk", "Payments"];
  }

  if (text.includes("saas") || text.includes("b2b")) {
    return ["Auth", "Workspace", "Billing", "Notifications"];
  }

  return ["Auth", "Core API", "Workflow"];
}

function inferFrontend(text: string): string {
  if (text.includes("mobile") || text.includes("ios") || text.includes("android")) {
    return "React Native + Web Companion";
  }

  return "Next.js 15 + React 19";
}

function inferApi(profile: ArchitectureProfile, text: string): string {
  if (profile === "serverless") {
    return "API Gateway + Lambda";
  }

  if (text.includes("graphql")) {
    return "Fastify + GraphQL";
  }

  return "Fastify + TypeScript";
}

function inferQueue(profile: ArchitectureProfile, text: string): string {
  if (profile === "realtime" || text.includes("kafka")) {
    return "Kafka (or Redis Streams)";
  }

  return "BullMQ + Redis";
}

function inferWorker(profile: ArchitectureProfile): string {
  if (profile === "serverless") {
    return "Event Workers (Lambda consumers)";
  }

  if (profile === "realtime") {
    return "Stream Processors + Async Workers";
  }

  return "Node.js Worker";
}

function inferDatabase(text: string): string {
  if (text.includes("postgres") || text.includes("postgresql")) {
    return "Postgres";
  }

  if (text.includes("mongo") || text.includes("mongodb")) {
    return "MongoDB";
  }

  return "SQLite";
}

function inferAi(text: string): string {
  if (text.includes("rag") || text.includes("vector")) {
    return "Mistral API + Vector DB + ElevenLabs TTS";
  }

  return "Mistral API + ElevenLabs TTS";
}

function architectureStack(payload: ArtifactGenerationJobPayload): ArchitectureStack {
  const text = architectureContextBlob(payload);
  const profile = inferArchitectureProfile(text);

  return {
    frontend: inferFrontend(text),
    api: inferApi(profile, text),
    queue: inferQueue(profile, text),
    worker: inferWorker(profile),
    database: inferDatabase(text),
    ai: inferAi(text)
  };
}

function microservicesMermaid(payload: ArtifactGenerationJobPayload): string {
  const services = inferDomainServices(architectureContextBlob(payload));
  const serviceLinks = services
    .map((service, index) => `  G --> S${index}[${service} Service]`)
    .join("\n");
  const serviceToDb = services
    .map((_, index) => `  S${index} --> D[(Primary DB)]`)
    .join("\n");

  return [
    "flowchart LR",
    "  U[User Voice/Text] --> W[Web App]",
    "  W --> A[Fastify API Gateway]",
    "  A --> M[Mistral API]",
    "  A --> E[ElevenLabs API]",
    "  A --> G[Service Layer]",
    serviceLinks,
    serviceToDb,
    "  G --> Q[(Redis Queue)]",
    "  Q --> R[Artifact Worker]",
    "  R --> D"
  ].join("\n");
}

function serverlessMermaid(): string {
  return [
    "flowchart LR",
    "  U[User Voice/Text] --> W[Web App]",
    "  W --> G[API Gateway]",
    "  G --> L[Lambda Orchestrator]",
    "  L --> M[Mistral API]",
    "  L --> E[ElevenLabs API]",
    "  L --> Q[(Event Queue)]",
    "  Q --> C[Lambda Consumers]",
    "  C --> D[(Primary DB)]"
  ].join("\n");
}

function realtimeMermaid(): string {
  return [
    "flowchart LR",
    "  U[User Voice/Text] --> W[Web App]",
    "  W --> A[Fastify API]",
    "  A --> M[Mistral API]",
    "  A --> E[ElevenLabs API]",
    "  A --> K[(Kafka / Redis Streams)]",
    "  K --> P[Stream Processor]",
    "  P --> D[(Operational DB)]",
    "  P --> R[Artifact Worker]",
    "  R --> D"
  ].join("\n");
}

function defaultMermaid(): string {
  return [
    "flowchart LR",
    "  U[User Voice/Text] --> W[Web App]",
    "  W --> A[Fastify API]",
    "  A --> M[Mistral API]",
    "  A --> E[ElevenLabs API]",
    "  A --> Q[(Redis Queue)]",
    "  Q --> R[Artifact Worker]",
    "  R --> D[(SQLite)]",
    "  A --> D"
  ].join("\n");
}

function architectureMermaid(payload: ArtifactGenerationJobPayload): string {
  const profile = inferArchitectureProfile(architectureContextBlob(payload));

  if (profile === "serverless") {
    return serverlessMermaid();
  }

  if (profile === "realtime") {
    return realtimeMermaid();
  }

  if (profile === "microservices") {
    return microservicesMermaid(payload);
  }

  return defaultMermaid();
}

function chatGroundingSnippet(payload: ArtifactGenerationJobPayload): string[] {
  const chatContext = readMetadataString(payload, "chat_context");
  if (!chatContext.trim()) {
    return [];
  }

  const lines = chatContext
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-4)
    .map((line) => `- ${line}`);

  return lines;
}

function architectureMarkdown(payload: ArtifactGenerationJobPayload): string {
  const assistant = payload.context.assistant;
  const actions = assistant.next_actions.map((action) => `- ${action}`).join("\n");
  const stack = architectureStack(payload);
  const mermaid = architectureMermaid(payload);
  const grounding = chatGroundingSnippet(payload);

  return [
    `# ${modeTitle("architecture")}`,
    "",
    "## Session",
    `- ID: ${payload.session.id}`,
    `- Mode: ${payload.session.mode}`,
    "",
    "## Product Context",
    payload.context.user_input,
    "",
    grounding.length > 0 ? "## Chat Grounding" : "",
    grounding.length > 0 ? grounding.join("\n") : "",
    grounding.length > 0 ? "" : "",
    "## System Diagram",
    "```mermaid",
    mermaid,
    "```",
    "",
    "## Recommended Stack",
    `- Frontend: ${stack.frontend}`,
    `- API: ${stack.api}`,
    `- Queue: ${stack.queue}`,
    `- Worker: ${stack.worker}`,
    `- Database: ${stack.database}`,
    `- AI: ${stack.ai}`,
    "",
    "## Architecture Summary",
    assistant.summary,
    "",
    "## Core Decision",
    assistant.decision,
    "",
    "## Build Plan",
    actions
  ]
    .filter(Boolean)
    .join("\n");
}

function toMarkdown(kind: ArtifactKind, payload: ArtifactGenerationJobPayload): string {
  if (kind === "architecture") {
    return architectureMarkdown(payload);
  }

  const assistant = payload.context.assistant;
  const actions = assistant.next_actions.map((action) => `- ${action}`).join("\n");

  return [
    `# ${modeTitle(kind)}`,
    "",
    "## Session",
    `- ID: ${payload.session.id}`,
    `- Mode: ${payload.session.mode}`,
    "",
    "## User Input",
    payload.context.user_input,
    "",
    "## Summary",
    assistant.summary,
    "",
    "## Decision",
    assistant.decision,
    "",
    "## Next Actions",
    actions
  ].join("\n");
}

export function generateArtifactsFromJob(
  payload: ArtifactGenerationJobPayload
): GeneratedArtifact[] {
  return payload.context.artifact_kinds.map((kind) => {
    const stack = kind === "architecture" ? architectureStack(payload) : undefined;
    const mermaid = kind === "architecture" ? architectureMermaid(payload) : undefined;
    const profile = kind === "architecture" ? inferArchitectureProfile(architectureContextBlob(payload)) : undefined;

    const content_json_value = {
      session: payload.session,
      kind,
      generated_at: new Date().toISOString(),
      summary: payload.context.assistant.summary,
      decision: payload.context.assistant.decision,
      next_actions: payload.context.assistant.next_actions,
      user_input: payload.context.user_input,
      metadata: payload.context.metadata ?? {},
      ...(stack ? { tech_stack: stack } : {}),
      ...(mermaid ? { diagram_mermaid: mermaid } : {}),
      ...(profile ? { architecture_profile: profile } : {})
    };

    return {
      id: randomUUID(),
      session_id: payload.session.id,
      kind,
      title: `${modeTitle(kind)} - ${new Date().toISOString().slice(0, 10)}`,
      content_md: toMarkdown(kind, payload),
      content_json: JSON.stringify(content_json_value)
    };
  });
}
