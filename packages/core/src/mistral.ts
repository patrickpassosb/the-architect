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
const { assistantResponseSchema, techStackSchema } = sharedTypes;

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
    "You are The Architect, a Senior Systems Design Engineer.",
    "Your objective is to provide rigorous technical analysis and architectural guidance based on first principles.",
    `Current mode: ${mode}.`,
    "",
    "CONVERSATIONAL RULES:",
    "1. TONE: Be objective, onboard the user, says that you are The Architect and explain things simple. Do not use exclamation points.",
    "2. PRECISION: Use technical and mathematical terminology where appropriate (e.g., latency, throughput, complexity, CAP theorem, first principles).",
    "3. DISCOVERY: Ask 1-2 focused questions to gather required technical constraints (SLAs, traffic patterns, data consistency needs).",
    "4. TRADE-OFF ANALYSIS: Always weigh technical decisions against mathematical and engineering constraints. Explain why one choice is superior to another for a specific use case.",
    "5. FORMATTING: Use Markdown for structure. Lead with technical findings. Keep blocks of text concise and focused.",
    "",
    "STRICT OUTPUT RULES:",
    "- Respond ONLY with strict JSON. No text outside the JSON.",
    "- Output shape: { \"summary\": \"string\", \"decision\": \"string\", \"next_actions\": [\"string\"] }",
    "- 'summary': Your response. Use Markdown here.",
    "- 'decision': A rigorous summary of the technical manifest state.",
    "- 'next_actions': 1-3 concise technical next steps.",
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
 * Solution: Use AbortController and Promise.race to enforce a timeout (default 12 seconds).
 */
export async function generateMistralAssistantResponse(
  input: MistralClientInput
): Promise<AssistantResponse> {
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? 12_000;

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
          max_tokens: 800, // Limit response size for faster processing
          response_format: { type: "json_object" },
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

/**
 * Specialized Function: Generates a Technical Manifest proposal.
 */
export async function generateMistralTechStackProposal(input: {
  apiKey: string;
  model: string;
  chatHistory: string;
  apiUrl?: string;
  timeoutMs?: number;
}): Promise<sharedTypes.TechStack> {
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? 30_000;

  const systemPrompt = [
    "You are The Architect, an expert technical co-founder.",
    "Analyze the conversation history and propose a complete Technical Manifest.",
    "Return ONLY strict JSON matching this schema:",
    "{",
    "  \"core\": { \"language\": \"string\", \"framework\": \"string\", \"database\": \"string\" },",
    "  \"data\": { \"cache\": \"string\", \"broker\": \"string\", \"storage\": \"string\" },",
    "  \"security\": { \"auth\": \"string\", \"provider\": \"string\", \"gateway\": \"string\" },",
    "  \"services\": { \"observability\": \"string\", \"external_apis\": \"string\" },",
    "  \"custom\": [{ \"key\": \"string\", \"value\": \"string\" }]",
    "}",
    "Fill in as much as possible based on context. Leave unknown fields as empty strings."
  ].join("\n");

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
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Context:\n${input.chatHistory}` }
          ]
        }),
        signal: controller.signal
      }),
      new Promise<Response>((_resolve, reject) => {
        setTimeout(() => {
          controller.abort();
          reject(new Error(`Tech stack proposal timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Mistral API error: ${response.status} - ${errorBody.slice(0, 300)}`);
    }

    const payload = (await response.json()) as MistralChoiceResponse;
    const rawContent = payload.choices?.[0]?.message?.content;
    const normalized = normalizeContent(rawContent);
    const parsed = parseJsonObject(normalized);

    return techStackSchema.parse(parsed);
  } finally {
    controller.abort();
  }
}

/**
 * Icon mapping for common cloud/infrastructure services.
 * Maps service keywords to publicly available SVG icon URLs.
 */
const SERVICE_ICON_MAP: Record<string, string> = {
  // AWS Services
  lambda: "https://cdn.simpleicons.org/awslambda/FF9900",
  s3: "https://cdn.simpleicons.org/amazons3/569A31",
  dynamodb: "https://cdn.simpleicons.org/amazondynamodb/4053D6",
  sqs: "https://cdn.simpleicons.org/amazonsqs/FF4F8B",
  sns: "https://cdn.simpleicons.org/amazonaws/232F3E",
  ec2: "https://cdn.simpleicons.org/amazonec2/FF9900",
  ecs: "https://cdn.simpleicons.org/amazonecs/FF9900",
  rds: "https://cdn.simpleicons.org/amazonrds/527FFF",
  cloudfront: "https://cdn.simpleicons.org/amazoncloudwatch/FF4F8B",
  "api gateway": "https://cdn.simpleicons.org/amazonapigateway/FF4F8B",
  apigateway: "https://cdn.simpleicons.org/amazonapigateway/FF4F8B",
  cognito: "https://cdn.simpleicons.org/amazonaws/232F3E",
  // GCP Services
  "cloud run": "https://cdn.simpleicons.org/googlecloud/4285F4",
  "cloud functions": "https://cdn.simpleicons.org/googlecloud/4285F4",
  pubsub: "https://cdn.simpleicons.org/googlecloud/4285F4",
  bigquery: "https://cdn.simpleicons.org/googlebigquery/669DF6",
  firestore: "https://cdn.simpleicons.org/firebase/FFCA28",
  firebase: "https://cdn.simpleicons.org/firebase/FFCA28",
  // General Database
  postgres: "https://cdn.simpleicons.org/postgresql/4169E1",
  postgresql: "https://cdn.simpleicons.org/postgresql/4169E1",
  mysql: "https://cdn.simpleicons.org/mysql/4479A1",
  mongodb: "https://cdn.simpleicons.org/mongodb/47A248",
  redis: "https://cdn.simpleicons.org/redis/FF4438",
  sqlite: "https://cdn.simpleicons.org/sqlite/003B57",
  elasticsearch: "https://cdn.simpleicons.org/elasticsearch/005571",
  // Messaging / Queues
  kafka: "https://cdn.simpleicons.org/apachekafka/231F20",
  rabbitmq: "https://cdn.simpleicons.org/rabbitmq/FF6600",
  bullmq: "https://cdn.simpleicons.org/redis/FF4438",
  // Frameworks / Runtimes
  react: "https://cdn.simpleicons.org/react/61DAFB",
  nextjs: "https://cdn.simpleicons.org/nextdotjs/000000",
  "next.js": "https://cdn.simpleicons.org/nextdotjs/000000",
  fastify: "https://cdn.simpleicons.org/fastify/000000",
  express: "https://cdn.simpleicons.org/express/000000",
  node: "https://cdn.simpleicons.org/nodedotjs/5FA04E",
  "node.js": "https://cdn.simpleicons.org/nodedotjs/5FA04E",
  docker: "https://cdn.simpleicons.org/docker/2496ED",
  kubernetes: "https://cdn.simpleicons.org/kubernetes/326CE5",
  nginx: "https://cdn.simpleicons.org/nginx/009639",
  // AI / ML
  openai: "https://cdn.simpleicons.org/openai/412991",
  mistral: "https://cdn.simpleicons.org/mistral/000000",
  // CDN / Web
  cloudflare: "https://cdn.simpleicons.org/cloudflare/F38020",
  vercel: "https://cdn.simpleicons.org/vercel/000000",
  // Generic
  user: "https://cdn.simpleicons.org/googlechrome/4285F4",
  client: "https://cdn.simpleicons.org/googlechrome/4285F4",
  browser: "https://cdn.simpleicons.org/googlechrome/4285F4",
  frontend: "https://cdn.simpleicons.org/react/61DAFB",
  backend: "https://cdn.simpleicons.org/nodedotjs/5FA04E",
  api: "https://cdn.simpleicons.org/fastify/000000",
  worker: "https://cdn.simpleicons.org/nodedotjs/5FA04E",
  queue: "https://cdn.simpleicons.org/redis/FF4438",
  database: "https://cdn.simpleicons.org/postgresql/4169E1",
  storage: "https://cdn.simpleicons.org/amazons3/569A31",
  cache: "https://cdn.simpleicons.org/redis/FF4438",
  auth: "https://cdn.simpleicons.org/auth0/EB5424",
  gateway: "https://cdn.simpleicons.org/amazonapigateway/FF4F8B",
  cdn: "https://cdn.simpleicons.org/cloudflare/F38020",
  monitoring: "https://cdn.simpleicons.org/grafana/F46800",
  logging: "https://cdn.simpleicons.org/grafana/F46800",
  notification: "https://cdn.simpleicons.org/twilio/F22F46",
  email: "https://gmail.simpleicons.org/EA4335",
  payment: "https://cdn.simpleicons.org/stripe/635BFF"
};

/**
 * Resolve an icon URL for a given service label.
 * Looks up the label (lowercased) against the SERVICE_ICON_MAP.
 */
function resolveServiceIcon(label: string): string {
  const lowered = label.toLowerCase();
  for (const [keyword, url] of Object.entries(SERVICE_ICON_MAP)) {
    if (lowered.includes(keyword)) {
      return url;
    }
  }
  return "";
}

/**
 * Blueprint generation types (local to this module).
 */
type BlueprintNodeRaw = {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  type?: string;
};

type BlueprintEdgeRaw = {
  source: string;
  target: string;
  label?: string;
};

type BlueprintPayload = {
  readme_md: string;
  blueprint_json: {
    nodes: BlueprintNodeRaw[];
    edges: BlueprintEdgeRaw[];
  };
};

/**
 * Generate an Architecture Blueprint from chat context.
 * Returns a README.md and a BLUEPRINT.json with React Flow nodes/edges.
 */
export async function generateArchitectureBlueprint(input: {
  apiKey: string;
  model: string;
  chatHistory: string;
  designSummary?: string;
  apiUrl?: string;
  timeoutMs?: number;
}): Promise<BlueprintPayload> {
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? 45_000;

  const systemPrompt = [
    "You are The Architect, an expert AI system architecture designer.",
    "Given the conversation context below, generate a complete system architecture blueprint.",
    "",
    "Return STRICT JSON with NO markdown. The JSON must have this exact shape:",
    "{",
    '  "readme_md": "string - A professional architecture README in Markdown format with sections: Overview, Components, Data Flow, Deployment, and Tech Stack",',
    '  "blueprint_json": {',
    '    "nodes": [{ "id": "string", "label": "string", "description": "string", "icon": "string (service keyword like lambda, postgres, react, etc)", "type": "string (one of: client, service, database, queue, external)" }],',
    '    "edges": [{ "source": "node_id", "target": "node_id", "label": "string (relationship description)" }]',
    "  }",
    "}",
    "",
    "Rules for the blueprint:",
    "- Create 6-15 nodes representing the key architectural components.",
    "- Each node should have a unique ID (kebab-case), a human-readable label, and a short description.",
    "- For the icon field, use a lowercase service keyword (e.g., 'lambda', 'postgres', 'react', 'redis', 'kafka').",
    "- Node types should be: 'client' for user-facing, 'service' for compute, 'database' for data stores, 'queue' for message brokers, 'external' for third-party APIs.",
    "- Create edges showing data flow between components. Each edge should have a descriptive label.",
    "- The README should be comprehensive but concise, suitable for a hackathon architecture doc.",
    "- Focus on the architecture that was discussed in the chat."
  ].join("\n");

  const userContent = [
    input.designSummary ? `## Current Design State Summary\n${input.designSummary}\n` : "",
    `## Chat History\n${input.chatHistory}`
  ].filter(Boolean).join("\n\n");

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
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent }
          ]
        }),
        signal: controller.signal
      }),
      new Promise<Response>((_resolve, reject) => {
        setTimeout(() => {
          controller.abort();
          reject(new Error(`Blueprint generation timed out after ${timeoutMs}ms`));
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
    const parsed = parseJsonObject(normalized) as BlueprintPayload;

    // Validate structure
    if (!parsed.readme_md || !parsed.blueprint_json) {
      throw new Error("Blueprint response missing required fields (readme_md, blueprint_json)");
    }

    if (!Array.isArray(parsed.blueprint_json.nodes) || !Array.isArray(parsed.blueprint_json.edges)) {
      throw new Error("Blueprint JSON missing nodes or edges arrays");
    }

    // Enrich nodes with resolved icon URLs
    for (const node of parsed.blueprint_json.nodes) {
      const iconKeyword = node.icon || node.label;
      node.icon = resolveServiceIcon(iconKeyword);
    }

    return parsed;
  } finally {
    controller.abort();
  }
}

/**
 * Generate a "Current Design State" summary from conversation history.
 * Called every 10 messages to maintain running design context.
 */
export async function generateDesignSummary(input: {
  apiKey: string;
  model: string;
  chatHistory: string;
  previousSummary?: string;
  apiUrl?: string;
  timeoutMs?: number;
}): Promise<string> {
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? 20_000;

  const systemPrompt = [
    "You are The Architect. Summarize the current state of the system design being discussed.",
    "Focus on: components decided, tech stack choices, architecture patterns, unresolved questions.",
    "Keep it concise (300-500 words). Output plain text, no JSON, no markdown formatting.",
    input.previousSummary ? `\nPrevious summary to update:\n${input.previousSummary}` : ""
  ].filter(Boolean).join("\n");

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
            { role: "system", content: systemPrompt },
            { role: "user", content: input.chatHistory }
          ]
        }),
        signal: controller.signal
      }),
      new Promise<Response>((_resolve, reject) => {
        setTimeout(() => {
          controller.abort();
          reject(new Error(`Design summary timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Mistral API ${response.status}: ${errorBody.slice(0, 500)}`);
    }

    const payload = (await response.json()) as MistralChoiceResponse;
    const rawContent = payload.choices?.[0]?.message?.content;
    return normalizeContent(rawContent).trim();
  } finally {
    controller.abort();
  }
}

/**
 * Decompose a build goal into 3-5 independent sub-tasks using Mistral.
 * Used by Turbo mode to parallelize code generation.
 */
export async function decomposeGoalIntoSubtasks(input: {
  apiKey: string;
  model: string;
  goal: string;
  blueprintContext?: string;
  architectureContext?: string;
  apiUrl?: string;
  timeoutMs?: number;
}): Promise<string[]> {
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? 20_000;

  const systemPrompt = [
    "You are The Architect, a technical task decomposition expert.",
    "Given a build goal and optional architecture context, decompose it into 3-5 independent sub-tasks.",
    "Each sub-task should be independently executable by a separate coding agent.",
    "",
    "Return STRICT JSON only, no markdown. The JSON must be an array of strings:",
    '["task 1 description", "task 2 description", ...]',
    "",
    "Rules:",
    "- Each task must be self-contained and independently implementable.",
    "- Tasks should NOT depend on each other's output.",
    "- Tasks should be specific and actionable (e.g., 'Create the user authentication API route with JWT validation').",
    "- Keep each task description under 200 characters.",
    "- Return exactly 3 to 5 tasks."
  ].join("\n");

  const userContent = [
    `Build Goal: ${input.goal}`,
    input.blueprintContext ? `\nBlueprint Context:\n${input.blueprintContext.slice(0, 3_000)}` : "",
    input.architectureContext ? `\nArchitecture Context:\n${input.architectureContext.slice(0, 3_000)}` : ""
  ].filter(Boolean).join("\n");

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
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent }
          ]
        }),
        signal: controller.signal
      }),
      new Promise<Response>((_resolve, reject) => {
        setTimeout(() => {
          controller.abort();
          reject(new Error(`Task decomposition timed out after ${timeoutMs}ms`));
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

    // Handle both { tasks: [...] } and direct [...] formats
    let tasks: unknown[];
    if (Array.isArray(parsed)) {
      tasks = parsed;
    } else if (
      parsed &&
      typeof parsed === "object" &&
      "tasks" in (parsed as Record<string, unknown>) &&
      Array.isArray((parsed as Record<string, unknown>).tasks)
    ) {
      tasks = (parsed as { tasks: unknown[] }).tasks;
    } else {
      throw new Error("Mistral did not return a valid tasks array");
    }

    const stringTasks = tasks
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .slice(0, 5);

    if (stringTasks.length < 2) {
      throw new Error("Mistral returned fewer than 2 decomposed tasks");
    }

    return stringTasks;
  } finally {
    controller.abort();
  }
}
