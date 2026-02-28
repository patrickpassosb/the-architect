import * as sharedTypes from "../../shared-types/dist/index.js";
import type { AssistantResponse, Mode } from "../../shared-types/dist/index.js";

const { assistantResponseSchema } = sharedTypes;

const DEFAULT_MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";

export type MistralClientInput = {
  apiKey: string;
  model: string;
  mode: Mode;
  userInput: string;
  apiUrl?: string;
  timeoutMs?: number;
};

type MistralChoiceResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

function buildSystemPrompt(mode: Mode): string {
  return [
    "You are The Architect, a technical cofounder assistant.",
    `Current mode: ${mode}.`,
    "Respond with strict JSON only and no markdown.",
    "Output shape:",
    '{"summary":"string","decision":"string","next_actions":["string"]}',
    "Keep the summary concise and actionable.",
    "Decision must be a single clear recommendation.",
    "Next actions must be concrete implementation steps."
  ].join("\n");
}

function normalizeContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (item && typeof item === "object" && "text" in item) {
          const text = (item as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();

  if (!trimmed) {
    throw new Error("Mistral returned an empty message");
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1]);
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
      throw new Error("Mistral response did not contain valid JSON");
    }

    const jsonSlice = trimmed.slice(firstBrace, lastBrace + 1);
    return JSON.parse(jsonSlice);
  }
}

export async function generateMistralAssistantResponse(
  input: MistralClientInput
): Promise<AssistantResponse> {
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? 20_000;

  try {
    const response = await Promise.race([
      fetch(input.apiUrl ?? DEFAULT_MISTRAL_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: input.model,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content: buildSystemPrompt(input.mode)
            },
            {
              role: "user",
              content: input.userInput
            }
          ]
        }),
        signal: controller.signal
      }),
      new Promise<Response>((_resolve, reject) => {
        setTimeout(() => {
          controller.abort();
          reject(new Error(`Mistral request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Mistral API ${response.status}: ${errorBody.slice(0, 500)}`);
    }

    const payload = (await response.json()) as MistralChoiceResponse;
    const rawContent = payload.choices?.[0]?.message?.content;
    const normalized = normalizeContent(rawContent);
    const parsed = parseJsonObject(normalized);

    return assistantResponseSchema.parse(parsed);
  } finally {
    controller.abort();
  }
}
