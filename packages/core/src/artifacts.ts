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

function modeTitle(kind: ArtifactKind) {
  if (kind === "architecture") return "Architecture Draft";
  if (kind === "tasks") return "Task Plan";
  return "Pitch Pack";
}

function toMarkdown(kind: ArtifactKind, payload: ArtifactGenerationJobPayload): string {
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
    const content_json_value = {
      session: payload.session,
      kind,
      generated_at: new Date().toISOString(),
      summary: payload.context.assistant.summary,
      decision: payload.context.assistant.decision,
      next_actions: payload.context.assistant.next_actions,
      user_input: payload.context.user_input,
      metadata: payload.context.metadata ?? {}
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
