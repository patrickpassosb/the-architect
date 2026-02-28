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

function modeTitle(kind: ArtifactKind) {
  if (kind === "architecture") return "Architecture Draft";
  if (kind === "tasks") return "Task Plan";
  return "Pitch Pack";
}

function architectureStack(): ArchitectureStack {
  return {
    frontend: "Next.js 15 + React 19",
    api: "Fastify + TypeScript",
    queue: "BullMQ + Redis",
    worker: "Node.js Worker",
    database: "SQLite",
    ai: "Mistral API + ElevenLabs TTS"
  };
}

function architectureMermaid(): string {
  return [
    "flowchart LR",
    "  U[User Voice/Text] --> W[Web App]",
    "  W --> A[Fastify API]",
    "  A --> M[Mistral API]",
    "  A --> E[ElevenLabs API]",
    "  A --> Q[(Redis Queue)]",
    "  Q --> R[Artifact Worker]",
    "  R --> D[(SQLite)]",
    "  A --> D",
    "  W --> A"
  ].join("\n");
}

function architectureMarkdown(payload: ArtifactGenerationJobPayload): string {
  const assistant = payload.context.assistant;
  const actions = assistant.next_actions.map((action) => `- ${action}`).join("\n");
  const stack = architectureStack();
  const mermaid = architectureMermaid();

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
  ].join("\n");
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
    const stack = kind === "architecture" ? architectureStack() : undefined;
    const mermaid = kind === "architecture" ? architectureMermaid() : undefined;

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
      ...(mermaid ? { diagram_mermaid: mermaid } : {})
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
