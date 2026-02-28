import {
  artifactDetailSchema,
  createSessionRequestSchema,
  createSessionResponseSchema,
  listArtifactsResponseSchema,
  sendMessageRequestSchema,
  sendMessageResponseSchema,
  type ArtifactDetail,
  type ArtifactListItem,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type SendMessageRequest,
  type SendMessageResponse
} from "@the-architect/shared-types";
import { z } from "zod";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function getApiUrl(pathname: string): string {
  const base = API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  return `${base}${pathname}`;
}

async function parseError(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    if (typeof payload?.message === "string" && payload.message.length > 0) {
      return payload.message;
    }

    if (typeof payload?.error === "string" && payload.error.length > 0) {
      return payload.error;
    }
  } catch {
    // Ignore JSON parse errors and fall through to status text.
  }

  return response.statusText || "Unknown API error";
}

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
      cache: "no-store"
    });
  } catch {
    throw new ApiError("API unavailable");
  }

  if (!response.ok) {
    const message = await parseError(response);
    throw new ApiError(message, response.status);
  }

  const json = await response.json();

  try {
    return schema.parse(json);
  } catch {
    throw new ApiError("Invalid API response shape");
  }
}

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

export async function getArtifacts(sessionId: string): Promise<ArtifactListItem[]> {
  return requestJson(`/api/sessions/${sessionId}/artifacts`, { method: "GET" }, listArtifactsResponseSchema);
}

export async function getArtifact(artifactId: string): Promise<ArtifactDetail> {
  return requestJson(`/api/artifacts/${artifactId}`, { method: "GET" }, artifactDetailSchema);
}
