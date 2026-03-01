/**
 * @fileoverview Logic for generating high-quality technical documents (artifacts).
 *
 * Problem: Once the AI gives us a structured JSON response, we need to turn it into
 * a professional-looking document (Markdown) and a machine-readable data format (JSON).
 *
 * Solution: This module takes the AI's response and transforms it into
 * 'Artifact' objects that can be stored in the database and shown to the user.
 */

import { randomUUID } from "node:crypto";
import type {
  ArtifactGenerationJobPayload,
  ArtifactKind
} from "@the-architect/shared-types";

// Type definition for a document we just generated
export type GeneratedArtifact = {
  id: string;
  session_id: string;
  kind: ArtifactKind;
  title: string;
  content_md: string;
  content_json: string;
};

/**
 * Helper: Provides a user-friendly name for each type of document.
 */
function modeTitle(kind: ArtifactKind) {
  if (kind === "architecture") return "Architecture Draft";
  if (kind === "tasks") return "Task Plan";
  return "Pitch Pack";
}

/**
 * Problem: Users want a clear, readable Markdown document they can share or print.
 * Solution: Combine the user's input and the AI's response into a structured
 * Markdown template.
 */
function toMarkdown(kind: ArtifactKind, payload: ArtifactGenerationJobPayload): string {
  const assistant = payload.context.assistant;
  // Convert the array of 'next actions' into a bulleted list for Markdown
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

/**
 * Main Function: Creates one or more documents from a background job payload.
 *
 * Problem: One user request might require multiple types of artifacts.
 * Solution: Map over the 'artifact_kinds' requested and generate each one.
 */
export function generateArtifactsFromJob(
  payload: ArtifactGenerationJobPayload
): GeneratedArtifact[] {
  return payload.context.artifact_kinds.map((kind) => {
    // Machine-readable data structure
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
      id: randomUUID(), // Unique ID for this document
      session_id: payload.session.id,
      kind,
      title: `${modeTitle(kind)} - ${new Date().toISOString().slice(0, 10)}`,
      content_md: toMarkdown(kind, payload),
      content_json: JSON.stringify(content_json_value)
    };
  });
}
