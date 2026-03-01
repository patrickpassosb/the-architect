# Technical Manifest: State of the Art Spec

## 1. Overview
The **Technical Manifest** (formerly Project Spec) is the single source of truth for the technical foundation of a project. It transitions from a simple form to a dynamic, AI-assisted co-founder dashboard.

## 2. Categorized Architecture
To provide a professional, expert-grade experience, the manifest is divided into logical architectural layers:

### A. Core Foundation
*   **Language & Runtime**: (e.g., Node.js 22, Go 1.23, Python 3.12)
*   **Primary Framework**: (e.g., Next.js, Gin, FastAPI)
*   **Primary Database**: (e.g., PostgreSQL, MongoDB)

### B. Data Layer
*   **Caching & State**: (e.g., Redis, Upstash)
*   **Message Broker**: (e.g., RabbitMQ, BullMQ, Kafka)
*   **Storage**: (e.g., AWS S3, Cloudflare R2)

### C. Security & Infrastructure
*   **Authentication**: (e.g., Clerk, NextAuth, Auth0)
*   **Cloud Provider**: (e.g., AWS, GCP, Vercel)
*   **API Gateway/CDN**: (e.g., Cloudflare, Nginx)

### D. Observability & Services
*   **Logging/Monitoring**: (e.g., Datadog, Grafana, Sentry)
*   **Third-Party APIs**: (e.g., Stripe, ElevenLabs, Twilio)

### E. Custom Fields
*   Unlimited key-value pairs for project-specific requirements (e.g., "Real-time: WebSockets").

---

## 3. The AI Co-founder Loop (State of the Art)

### ✨ "Propose from Chat" Workflow
Instead of manual entry only, the user can trigger an AI analysis of the current conversation.

1.  **Analysis**: The Architect reviews the entire chat history to identify technical preferences, hard requirements, and suggested tools.
2.  **Review Suggestions Popup (Side-by-Side)**:
    *   A modal appears showing a comparison between the **Current Manifest** and the **AI Recommendations**.
    *   **Logic**: If the user said "I want safety," the AI suggests `Rust` even if the field is currently `Node.js`.
    *   **Interaction**: The user can `[Accept]` or `[Ignore]` each individual recommendation.
3.  **The Merge**: Accepted changes are applied to the form.

### 💾 Milestone Persistence
*   **Database**: The manifest is stored as a structured JSON object in the `tech_stack` column of the `sessions` table.
*   **Context Sync**: Every subsequent message sent to the Architect includes the full Technical Manifest in the system context. This ensures the AI never "forgets" confirmed technical decisions.

---

## 4. Implementation Goals (Hackathon MVP)
1.  **Database Migration**: Add `tech_stack` to `sessions`.
2.  **Stateful UI**: Implement the categorized form with real-time editing.
3.  **Review UI**: Build the Side-by-Side comparison modal for AI suggestions.
4.  **Backend Integration**: Update the AI prompt logic to include the manifest context.
