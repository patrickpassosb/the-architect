/**
 * @fileoverview Integration with the Mistral AI API.
 *
 * Problem: We need an AI "brain" that can understand user input and provide
 * technical advice in a structured format that our UI can display.
 *
 * Solution: Connect to Mistral AI's API using their 'Large' model. We provide
 * a "System Prompt" that tells the AI to act as a technical cofounder and
 * to always respond in a specific JSON format.
 */

import * as sharedTypes from "../../shared-types/dist/index.js";
import type { AssistantResponse, Mode } from "../../shared-types/dist/index.js";

// We use the shared schema to validate the AI's response before using it.
const { assistantResponseSchema } = sharedTypes;

const DEFAULT_MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";

/**
 * Configuration for the Mistral API client.
 */
export type MistralClientInput = {
  apiKey: string;    // Your MISTRAL_API_KEY
  model: string;     // e.g., 'mistral-large-latest'
  mode: Mode;        // 'architect', 'planner', or 'pitch'
  userInput: string; // The user's message or transcript
  apiUrl?: string;
  timeoutMs?: number;
};

/**
 * Represents the raw response structure from the Mistral API.
 */
type MistralChoiceResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

/**
 * Problem: AI models are creative and might respond with conversational text.
 * Solution: Provide a 'System Prompt' that strictly instructs the model
 * to ONLY output JSON and follow our specific structure.
 */
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

/**
 * Helper: Handle different formats of AI response content (string vs array).
 */
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

/**
 * Problem: The AI might wrap its JSON in markdown code blocks (```json ... ```).
 * Solution: This function finds and extracts the JSON part of the string.
 */
function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();

  if (!trimmed) {
    throw new Error("Mistral returned an empty message");
  }

  // Look for JSON inside triple backticks
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1]);
  }

  try {
    // Try parsing the whole thing as JSON
    return JSON.parse(trimmed);
  } catch {
    // If that fails, try to find the first '{' and last '}'
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
      throw new Error("Mistral response did not contain valid JSON");
    }

    const jsonSlice = trimmed.slice(firstBrace, lastBrace + 1);
    return JSON.parse(jsonSlice);
  }
}

/**
 * Main Function: Sends user input to Mistral and returns a structured response.
 *
 * Problem: Network requests can hang forever.
 * Solution: Use AbortController and Promise.race to enforce a timeout (default 20 seconds).
 */
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
          temperature: 0.2, // Lower temperature makes the AI more focused/less creative.
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

    // Validate that the parsed JSON matches our expected 'AssistantResponse' schema.
    return assistantResponseSchema.parse(parsed);
  } finally {
    // Ensure the request is canceled if it's still running.
    controller.abort();
  }
}
