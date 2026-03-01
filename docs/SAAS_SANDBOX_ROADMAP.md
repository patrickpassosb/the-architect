# SaaS Sandbox Roadmap: Secure AI Execution

This document outlines the planned transition from local project isolation to a fully hardened, containerized sandbox environment for production SaaS deployments of **The Architect**.

## Current State: Workspace Isolation (MVP)
For the hackathon MVP, we use **filesystem-level isolation**:
- All builds are scoped to `the-architect/projects/{session-id}/`.
- The AI agent is instructed via system prompt to remain within this boundary.
- **Risk:** High-trust model. The agent technically has the same OS permissions as the API server.

---

## Phase 1: Docker Containerization (Scale-up)
In this phase, we move the "Workbench" into a **Docker Container**.

### 1. Architecture
- **API Server:** Orchestrates the build.
- **Worker:** Spawns a dedicated Docker container per build request.
- **Volume Mounts:** Only the specific project sub-directory is mounted into `/workspace` inside the container.

### 2. Benefits
- **System Safety:** Even a destructive hallucination (`rm -rf /`) only affects the temporary container environment, leaving the host OS and other users' data untouched.
- **Resource Quotas:** Limit the agent to specific CPU/Memory to prevent "Fork Bomb" attacks or resource exhaustion.
- **Environment Parity:** Every agent starts with a fresh, identical "Gold Image" (Ubuntu/Node.js/Python), eliminating "it works on my machine" bugs.

### 3. Implementation Plan
```bash
# Example Spawning Logic
docker run --rm \
  --name "build-agent-{session-id}" \
  --memory "2g" --cpus "1.0" \
  -v "./projects/{session-id}:/workspace" \
  architect-vibe-image \
  vibe --workdir /workspace -p "{prompt}" --agent auto-approve
```

---

## Phase 2: Total Air-Gap Isolation (Hardened SaaS)
For a true multi-tenant SaaS, we move beyond Docker into **Micro-VMs** (e.g., Firecracker or Fly.io Machines).

### 1. Network Sandboxing
- **Egress Filtering:** The agent can only reach `npm.org` or `github.com`. It cannot reach internal company metadata services (IMDS) or other users' internal APIs.
- **Zero Ingress:** No one can SSH or connect to the agent while it is working.

### 2. Ephemeral Workspaces
- Entire storage volumes are deleted immediately after the build is "delivered" or the session expires.
- No cross-contamination of code between User A and User B.

---

## Phase 3: The "Diff-Only" Handover
Instead of letting the agent write directly to the project, the agent creates a **Proposed Change Set**.
- The sandboxed agent generates a `.patch` or `JSON` diff.
- The API server reviews the diff for dangerous patterns (malware detection).
- Only after passing "Static Analysis," the host server applies the changes to the user's project.

---

## Future Goals
- **Multi-Cloud Sandboxing:** Ability to choose where the agent works (AWS Lambda, Google Cloud Run, or local Docker).
- **Time-Travel Debugging:** Snapshotting the container state at every step of the build so the user can "rewind" the agent's actions if it makes a mistake.
