# Mistral Vibe & ElevenLabs Improvements

This document outlines the proposed architectural and prompt-level improvements to deepen the integration of **Mistral Vibe** and **ElevenLabs** into "The Architect."

---

## 1. Mistral Vibe Native Integration

To align this project with the Mistral Vibe philosophy (Agentic, Tool-First, and Minimalist), we will implement a project-local Vibe configuration.

### A. Project-Specific Vibe Environment
We will create a `.vibe/` directory in the repository root to enable a specialized "Architect" workflow directly from the CLI:
*   **`.vibe/agents/architect.toml`**: A custom agent definition that inherits from the standard Vibe agent but is pre-configured with the "The Architect" persona and high-authority tool permissions.
*   **`.vibe/prompts/architect.md`**: A dedicated system prompt that enforces the "Senior Systems Architect" identity and the Phase-based workflow (Orient -> Plan -> Execute).
*   **`.vibe/skills/architect/SKILL.md`**: A project-specific "Skill" that adds custom tools for the Architect, such as `export_blueprint` or `validate_stack`, which can interface directly with the project's local data.

### B. Prompt Alignment (Web UI)
The prompts used in `packages/core/src/mistral.ts` will be refactored to match the Mistral Vibe standard:
*   **Phase-Based Logic:** Forcing the AI to "Orient" (understand context) before "Planning" or "Executing" code changes.
*   **No Noise Policy:** Removing conversational filler ("Certainly!", "I'd be happy to...") to maximize token efficiency and maintain a professional tone.

### C. Structured Clarification (`ask_user_question`)
We will port the logic of Vibe's `ask_user_question` tool into the core backend.
*   **UI Impact:** Instead of the AI asking an open-ended question like "What database do you want?", it will return a structured set of options (e.g., PostgreSQL, MongoDB, Redis).
*   **Benefit:** The Web UI can render these as clickable buttons, speeding up the user experience and reducing the cost of correcting AI "guesses."

---

## 2. ElevenLabs (Voice) Enhancements

For users on the **Free Tier**, these improvements focus on lowering latency and preserving character credits.

### A. Low-Latency Streaming
Currently, the API synthesizes a full audio buffer before sending it to the frontend.
*   **Proposed Change:** Switch to ElevenLabs' chunked HTTP or WebSocket streaming.
*   **Result:** Playback begins as soon as the first few words are synthesized, making the conversation feel real-time.

### B. Cost Optimization (Free Tier Friendly)
To stay within the 10,000 character monthly limit:
*   **Selective Synthesis:** Configure the engine to only synthesize the `summary` field from the AI response. 

### C. Dynamic Personas
*   **Architect Mode:** Uses an authoritative, steady voice (e.g., "Brian" or "George").
*   **No Extra Cost:** Changing voices is a metadata update and does not affect character billing.

---

## Next Steps
1.  **Refactor `packages/core/src/mistral.ts`** to implement Phase-based prompts and the `ask_user_question` schema.
2.  **Initialize the `.vibe/` directory** with the `architect` agent and prompt files.
3.  **Update `apps/api/src/index.ts`** to support ElevenLabs streaming responses.
