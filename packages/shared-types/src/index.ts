/**
 * @fileoverview Centralized Zod schemas and TypeScript types for the entire project.
 *
 * Problem: In a full-stack application (Web, API, Worker), we need to ensure that data
 * sent between services is valid and consistent. If the API expects a 'title' but the Web
 * app sends 'name', the system will crash.
 *
 * Solution: Use Zod to define a "Single Source of Truth" for our data structures.
 * These schemas validate data at runtime (when it arrives via an API request)
 * and provide TypeScript types for compile-time safety.
 */

import { z } from "zod";

/**
 * Basic Enumerations
 * We define exactly what strings are allowed for specific fields.
 */

// The three main modes of 'The Architect'
export const modeSchema = z.enum(["architect", "planner", "pitch"]);

// Where did the message come from? (Microphone vs Keyboard)
export const sourceSchema = z.enum(["voice", "text"]);

// Who sent the message in the conversation?
export const roleSchema = z.enum(["user", "assistant", "system"]);

// What kind of document (artifact) are we generating?
export const artifactKindSchema = z.enum(["architecture", "tasks", "pitch"]);

// What kind of background job is this?
export const jobKindSchema = z.enum(["artifact_generation"]);

/**
 * API Request Parameters
 * Used to validate IDs passed in the URL (e.g., /api/sessions/:id)
 */

export const sessionIdParamsSchema = z.object({
  id: z.string().min(1) // ID must be a non-empty string
});

export const artifactIdParamsSchema = z.object({
  id: z.string().min(1)
});

/**
 * Health Check Schema
 * Used to verify if the API is running correctly.
 */
export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("api"),
  timestamp: z.string().datetime()
});

/**
 * Session Management Schemas
 */

// What we need from the user to start a new chat session
export const createSessionRequestSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  mode: modeSchema
});

// What the API returns after a session is created
export const createSessionResponseSchema = z.object({
  id: z.string().min(1),
  mode: modeSchema
});

/**
 * Messaging Schemas
 */

// When a user sends a message (either text or voice transcript)
export const sendMessageRequestSchema = z.object({
  content: z.string().trim().min(1),
  source: sourceSchema
});

// The structured response from the AI assistant (Mistral)
export const assistantResponseSchema = z.object({
  summary: z.string().min(1),      // A short version of the response
  decision: z.string().min(1),     // The primary technical recommendation
  next_actions: z.array(z.string().min(1)) // Steps for the user to take next
});

// Information about a job that was added to the queue (e.g., generating a PDF)
export const queuedJobSchema = z.object({
  id: z.string().min(1),
  kind: jobKindSchema
});

// The final response the API sends back to the Web UI after a message
export const sendMessageResponseSchema = z.object({
  assistant: assistantResponseSchema,
  queued_jobs: z.array(queuedJobSchema)
});

/**
 * Artifact (Document) Schemas
 */

// Used for showing a list of documents in the sidebar
export const artifactListItemSchema = z.object({
  id: z.string().min(1),
  kind: artifactKindSchema,
  title: z.string().min(1)
});

export const listArtifactsResponseSchema = z.array(artifactListItemSchema);

// The full details of a specific document
export const artifactDetailSchema = z.object({
  id: z.string().min(1),
  kind: artifactKindSchema,
  title: z.string().min(1),
  content_md: z.string(), // The document content in Markdown format
  content_json: z.unknown().nullable() // Optional machine-readable data
});

/**
 * Queue & Background Worker Schemas
 * These define the "contracts" for background tasks.
 */
export const synthesizeVoiceRequestSchema = z.object({
  text: z.string().trim().min(1).max(4_000)
});

export const synthesizeVoiceResponseSchema = z.object({
  provider: z.literal("elevenlabs"),
  content_type: z.string().min(1),
  audio_base64: z.string().min(1)
});

export const runBuildRequestSchema = z.object({
  goal: z.string().trim().min(1).max(1_000).optional(),
  context: z.string().trim().min(1).max(12_000).optional(),
  dry_run: z.boolean().optional().default(false)
});

export const runBuildResponseSchema = z.object({
  build_id: z.string().min(1),
  status: z.enum(["completed", "failed", "timed_out"]),
  command: z.string().min(1),
  exit_code: z.number().int().nullable(),
  output: z.string(),
  duration_ms: z.number().int().nonnegative(),
  notes: z.array(z.string())
});

export const generateArchitectureRequestSchema = z.object({
  focus: z.string().trim().min(1).max(600).optional()
});

export const generateArchitectureResponseSchema = z.object({
  queued_job: queuedJobSchema,
  source: z.enum(["latest_assistant", "generated_assistant"])
});

/**
 * Blueprint (React Flow) Schemas
 * Defines the node/edge graph data for the interactive architecture canvas.
 */
export const blueprintNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional().default(""),
  icon: z.string().optional().default(""),
  type: z.string().optional().default("default")
});

export const blueprintEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().optional().default("")
});

export const blueprintJsonSchema = z.object({
  nodes: z.array(blueprintNodeSchema),
  edges: z.array(blueprintEdgeSchema)
});

export const blueprintResponseSchema = z.object({
  readme_md: z.string(),
  blueprint_json: blueprintJsonSchema
});

export const savedNodePositionSchema = z.object({
  id: z.string().min(1),
  x: z.number(),
  y: z.number()
});

export const saveLayoutRequestSchema = z.object({
  positions: z.array(savedNodePositionSchema)
});

export const saveLayoutResponseSchema = z.object({
  saved: z.boolean()
});

export const getBlueprintResponseSchema = z.object({
  artifact_id: z.string().nullable(),
  readme_md: z.string(),
  blueprint_json: blueprintJsonSchema.nullable(),
  saved_positions: z.array(savedNodePositionSchema)
});

export const designSummarySchema = z.object({
  session_id: z.string().min(1),
  summary: z.string(),
  message_count: z.number().int().nonnegative(),
  created_at: z.string()
});

export const queueNameSchema = z.enum(["artifact_generation"]);
export const artifactJobNameSchema = z.enum(["artifact_generation"]);

// Context needed by the worker to generate a document
export const artifactGenerationContextSchema = z.object({
  user_input: z.string().min(1),
  assistant: assistantResponseSchema,
  artifact_kinds: z.array(artifactKindSchema).min(1).default(["architecture"]),
  metadata: z.record(z.string(), z.unknown()).optional()
});

// Session data needed by the worker
export const artifactGenerationSessionSchema = z.object({
  id: z.string().min(1),
  mode: modeSchema,
  title: z.string().min(1).optional()
});

// The complete package (payload) sent to the BullMQ queue
export const artifactGenerationJobPayloadSchema = z.object({
  session: artifactGenerationSessionSchema,
  context: artifactGenerationContextSchema
});

/**
 * TypeScript Type Definitions
 * These are inferred directly from the Zod schemas above.
 *
 * Why: This avoids writing the same interface twice. If the Zod schema changes,
 * the TypeScript type updates automatically.
 */

export type Mode = z.infer<typeof modeSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Role = z.infer<typeof roleSchema>;
export type ArtifactKind = z.infer<typeof artifactKindSchema>;
export type JobKind = z.infer<typeof jobKindSchema>;

export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;
export type CreateSessionResponse = z.infer<typeof createSessionResponseSchema>;
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;
export type AssistantResponse = z.infer<typeof assistantResponseSchema>;
export type QueuedJob = z.infer<typeof queuedJobSchema>;
export type SendMessageResponse = z.infer<typeof sendMessageResponseSchema>;
export type ArtifactListItem = z.infer<typeof artifactListItemSchema>;
export type ArtifactDetail = z.infer<typeof artifactDetailSchema>;
export type SynthesizeVoiceRequest = z.infer<typeof synthesizeVoiceRequestSchema>;
export type SynthesizeVoiceResponse = z.infer<typeof synthesizeVoiceResponseSchema>;
export type RunBuildRequest = z.infer<typeof runBuildRequestSchema>;
export type RunBuildResponse = z.infer<typeof runBuildResponseSchema>;
export type GenerateArchitectureRequest = z.infer<typeof generateArchitectureRequestSchema>;
export type GenerateArchitectureResponse = z.infer<typeof generateArchitectureResponseSchema>;
export type QueueName = z.infer<typeof queueNameSchema>;
export type ArtifactJobName = z.infer<typeof artifactJobNameSchema>;
export type ArtifactGenerationContext = z.infer<
  typeof artifactGenerationContextSchema
>;
export type ArtifactGenerationSession = z.infer<
  typeof artifactGenerationSessionSchema
>;
export type ArtifactGenerationJobPayload = z.infer<
  typeof artifactGenerationJobPayloadSchema
>;
export type BlueprintNode = z.infer<typeof blueprintNodeSchema>;
export type BlueprintEdge = z.infer<typeof blueprintEdgeSchema>;
export type BlueprintJson = z.infer<typeof blueprintJsonSchema>;
export type BlueprintResponse = z.infer<typeof blueprintResponseSchema>;
export type SavedNodePosition = z.infer<typeof savedNodePositionSchema>;
export type SaveLayoutRequest = z.infer<typeof saveLayoutRequestSchema>;
export type SaveLayoutResponse = z.infer<typeof saveLayoutResponseSchema>;
export type GetBlueprintResponse = z.infer<typeof getBlueprintResponseSchema>;
export type DesignSummary = z.infer<typeof designSummarySchema>;
