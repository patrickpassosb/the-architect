/**
 * @fileoverview API Client for the 'The Architect' Frontend.
 *
 * Problem: The Next.js frontend needs a clean, reliable way to talk
 * to the Fastify API (running on port 4000). We need to handle
 * network errors, JSON parsing, and data validation.
 *
 * Solution: A set of asynchronous functions that use the browser's
 * 'fetch' API. We use the same Zod schemas as the backend to
 * ensure the data we send and receive is correct.
 */

import {
  artifactDetailSchema,
  createSessionRequestSchema,
  createSessionResponseSchema,
  generateArchitectureRequestSchema,
  generateArchitectureResponseSchema,
  listArtifactsResponseSchema,
  runBuildRequestSchema,
  runBuildResponseSchema,
  sendMessageRequestSchema,
  sendMessageResponseSchema,
  synthesizeVoiceRequestSchema,
  synthesizeVoiceResponseSchema,
  type ArtifactDetail,
  type ArtifactListItem,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type GenerateArchitectureRequest,
  type GenerateArchitectureResponse,
  type RunBuildRequest,
  type RunBuildResponse,
  type SendMessageRequest,
  type SendMessageResponse,
  type SynthesizeVoiceRequest,
  type SynthesizeVoiceResponse
} from "@the-architect/shared-types";
import { z } from "zod";

// Base URL for the API (loaded from environment variables)
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

/**
 * Custom Error class for API-related issues.
 *
 * Problem: Standard Error objects don't include HTTP status codes.
 * Solution: Extend the Error class to include a 'status' field (e.g., 404, 500).
 */
export class ApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Helper: Build the full URL for an API request.
 */
function getApiUrl(pathname: string): string {
  const base = API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  return `${base}${pathname}`;
}

/**
 * Helper: Extract the error message from an API response body.
 */
async function parseError(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    // Look for common error fields (message or error)
    if (typeof payload?.message === "string" && payload.message.length > 0) {
      return payload.message;
    }

    if (typeof payload?.error === "string" && payload.error.length > 0) {
      return payload.error;
    }
  } catch {
    // If JSON parsing fails, use the default status text (e.g., "Internal Server Error")
  }

  return response.statusText || "Unknown API error";
}

/**
 * Generic Request Function
 *
 * Problem: Fetching JSON involves many repetitive steps (headers, status checks, parsing).
 * Solution: A single reusable function that handles all the common logic
 * and validates the final result against a Zod schema.
 */
async function requestJson<TSchema extends z.ZodTypeAny>(
  pathname: string,
  options: RequestInit,
  schema: TSchema
): Promise<z.infer<TSchema>> {
  let response: Response;

  try {
    response = await fetch(getApiUrl(pathname), {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {})
      },
      // Ensure we always get the freshest data from the server
      cache: "no-store"
    });
  } catch {
    // This happens if the server is down or the network is disconnected
    throw new ApiError("API unavailable");
  }

  // Handle HTTP error statuses (4xx and 5xx)
  if (!response.ok) {
    const message = await parseError(response);
    throw new ApiError(message, response.status);
  }

  const json = await response.json();

  // Safety: Validate that the data the server sent back matches our expectations
  try {
    return schema.parse(json);
  } catch {
    throw new ApiError("Invalid API response shape");
  }
}

/**
 * API Call: Create a new session.
 */
export async function createSession(
  payload: CreateSessionRequest
): Promise<CreateSessionResponse> {
  const parsed = createSessionRequestSchema.parse(payload);
  return requestJson(
    "/api/sessions",
    {
      method: "POST",
      body: JSON.stringify(parsed)
    },
    createSessionResponseSchema
  );
}

/**
 * API Call: Send a message (text or voice) to the AI.
 */
export async function sendMessage(
  sessionId: string,
  payload: SendMessageRequest
): Promise<SendMessageResponse> {
  const parsed = sendMessageRequestSchema.parse(payload);
  return requestJson(
    `/api/sessions/${sessionId}/messages`,
    {
      method: "POST",
      body: JSON.stringify(parsed)
    },
    sendMessageResponseSchema
  );
}

/**
 * API Call: Get a list of documents for a session.
 */
export async function getArtifacts(sessionId: string): Promise<ArtifactListItem[]> {
  return requestJson(`/api/sessions/${sessionId}/artifacts`, { method: "GET" }, listArtifactsResponseSchema);
}

/**
 * API Call: Get the full content of a specific document.
 */
export async function getArtifact(artifactId: string): Promise<ArtifactDetail> {
  return requestJson(`/api/artifacts/${artifactId}`, { method: "GET" }, artifactDetailSchema);
}

export async function synthesizeVoice(
  payload: SynthesizeVoiceRequest
): Promise<SynthesizeVoiceResponse> {
  const parsed = synthesizeVoiceRequestSchema.parse(payload);
  return requestJson(
    "/api/voice/synthesize",
    {
      method: "POST",
      body: JSON.stringify(parsed)
    },
    synthesizeVoiceResponseSchema
  );
}

export async function runBuildWithVibe(
  sessionId: string,
  payload: RunBuildRequest
): Promise<RunBuildResponse> {
  const parsed = runBuildRequestSchema.parse(payload);
  return requestJson(
    `/api/sessions/${sessionId}/build`,
    {
      method: "POST",
      body: JSON.stringify(parsed)
    },
    runBuildResponseSchema
  );
}

export async function generateArchitectureFromChat(
  sessionId: string,
  payload: GenerateArchitectureRequest = {}
): Promise<GenerateArchitectureResponse> {
  const parsed = generateArchitectureRequestSchema.parse(payload);
  return requestJson(
    `/api/sessions/${sessionId}/architecture`,
    {
      method: "POST",
      body: JSON.stringify(parsed)
    },
    generateArchitectureResponseSchema
  );
}
