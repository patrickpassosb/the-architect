import { z } from "zod";

export const modeSchema = z.enum(["architect", "planner", "pitch"]);
export const sourceSchema = z.enum(["voice", "text"]);
export const roleSchema = z.enum(["user", "assistant", "system"]);
export const artifactKindSchema = z.enum(["architecture", "tasks", "pitch"]);
export const jobKindSchema = z.enum(["artifact_generation"]);

export const sessionIdParamsSchema = z.object({
  id: z.string().min(1)
});

export const artifactIdParamsSchema = z.object({
  id: z.string().min(1)
});

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("api"),
  timestamp: z.string().datetime()
});

export const createSessionRequestSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  mode: modeSchema
});

export const createSessionResponseSchema = z.object({
  id: z.string().min(1),
  mode: modeSchema
});

export const sendMessageRequestSchema = z.object({
  content: z.string().trim().min(1),
  source: sourceSchema
});

export const assistantResponseSchema = z.object({
  summary: z.string().min(1),
  decision: z.string().min(1),
  next_actions: z.array(z.string().min(1))
});

export const queuedJobSchema = z.object({
  id: z.string().min(1),
  kind: jobKindSchema
});

export const sendMessageResponseSchema = z.object({
  assistant: assistantResponseSchema,
  queued_jobs: z.array(queuedJobSchema)
});

export const artifactListItemSchema = z.object({
  id: z.string().min(1),
  kind: artifactKindSchema,
  title: z.string().min(1)
});

export const listArtifactsResponseSchema = z.array(artifactListItemSchema);

export const artifactDetailSchema = z.object({
  id: z.string().min(1),
  kind: artifactKindSchema,
  title: z.string().min(1),
  content_md: z.string(),
  content_json: z.unknown().nullable()
});

export const queueNameSchema = z.enum(["artifact_generation"]);
export const artifactJobNameSchema = z.enum(["artifact_generation"]);

export const artifactGenerationContextSchema = z.object({
  user_input: z.string().min(1),
  assistant: assistantResponseSchema,
  artifact_kinds: z.array(artifactKindSchema).min(1).default(["architecture"]),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const artifactGenerationSessionSchema = z.object({
  id: z.string().min(1),
  mode: modeSchema,
  title: z.string().min(1).optional()
});

export const artifactGenerationJobPayloadSchema = z.object({
  session: artifactGenerationSessionSchema,
  context: artifactGenerationContextSchema
});

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
