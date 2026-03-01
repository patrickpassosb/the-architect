# The Architect — Developer's Journey 🚀

Welcome! This guide is designed to help you, a developer new to **The Architect**, understand the project from the inside out. We've structured this as a "guided tour" through the codebase.

## 📍 Prerequisites
Before you start, make sure you've followed the **Quick Start** in the [README.md](./README.md). You should have `npm install` completed and a `.env` file with your `MISTRAL_API_KEY`.

---

## 🗺️ The Tour Map

### 1. The "Single Source of Truth" 📖
**Start here:** [`packages/shared-types/src/index.ts`](./packages/shared-types/src/index.ts)

In a monorepo, multiple services (Web, API, Worker) need to speak the same "language." We use **Zod** to define our data structures.
- **Read this file first** to see how we define what a `Session`, a `Message`, and an `Artifact` (document) look like.

### 2. The Core "Brain" 🧠
**Next stop:** [`packages/core/src/`](./packages/core/src/)

This package contains the logic shared between the API and the Worker.
- [`db.ts`](./packages/core/src/db.ts): See how we use **SQLite** to persist data.
- [`mistral.ts`](./packages/core/src/mistral.ts): Look at how we craft "System Prompts" to make the AI respond in structured JSON.
- [`queue.ts`](./packages/core/src/queue.ts): Learn how we use **BullMQ** to move slow tasks (like document generation) to the background.

### 3. The API Orchestrator 📡
**Moving on to:** [`apps/api/src/index.ts`](./apps/api/src/index.ts)

This is the central hub. It uses **Fastify** to handle requests from the Web UI.
- Look at the `POST /api/sessions/:id/messages` route. This is where the magic happens: it saves the user's message, asks the AI for a decision, and then kicks off a background job to generate a full document.

### 4. The Background Worker 👷
**Check out:** [`apps/worker/src/index.ts`](./apps/worker/src/index.ts)

While the API is busy talking to the user, the Worker is in the background doing the heavy lifting.
- See how it "consumes" jobs from the queue, generates Markdown artifacts using [`artifacts.ts`](./packages/core/src/artifacts.ts), and saves them back to the database.

### 5. The User Interface 🎨
**Final destination:** [`apps/web/app/page.tsx`](./apps/web/app/page.tsx)

This is a **Next.js** application. It's the "face" of the project.
- **Voice Integration:** Look at [`apps/web/src/hooks/useVoiceTranscript.ts`](./apps/web/src/hooks/useVoiceTranscript.ts) to see how we use the browser's Microphone.
- **State Management:** See how `useState` and `useEffect` are used in the main `page.tsx` to keep the chat history and the list of documents updated in real-time.

---

## 🧪 How to Verify Your Changes
Once you've made a change, you can run our integration tests to make sure everything still works:
```bash
# Terminal 1: Start the services
npm run dev

# Terminal 2: Run the tests
npm run test:integration
```
Check out [`tests/integration.mjs`](./tests/integration.mjs) to see how we simulate a real user interaction!

## 💡 Pro Tips for Hackathons
- **Logs are your friends:** We use a JSON logger. Watch the terminal where `npm run dev` is running to see exactly what the API and Worker are doing.
- **SQLite is simple:** If you want to "reset" your database, you can just delete the `./data/the-architect.sqlite` file. It will be recreated automatically the next time you start the app.
- **Zod is strict:** If you change a data structure in `shared-types`, the API will automatically start rejecting requests that don't match the new structure. This helps you catch bugs early!

Happy Building! 🛠️
