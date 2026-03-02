# Terminal Overhaul Plan

## Overview
Improve the build terminal UI/UX from basic `<div>` output to a proper terminal experience with real-time feedback, better error handling, and xterm.js integration.

## 8-Hour Implementation Plan

### Hour 1: Better Tool Call Display
Parse and display tool calls with meaningful context:
- Show function name + key arguments + result summary
- Example output: `[Tool] write_file → src/App.tsx (142 lines)` instead of just `[Tool] write_file`

### Hour 2: File Change Notifications  
Detect when Vibe writes/modifies files:
- Parse `write_file` tool calls from JSON output
- Extract filename from arguments
- Publish as "📝 Created/Modified: filename" notification

### Hour 3: Improved Error Handling
Replace cryptic errors with actionable messages:
- Detect Docker not running → "Please start Docker Desktop"
- Detect missing sandbox image → Show build command
- Handle timeout, network, and permission errors gracefully

### Hours 4-6: xterm.js Terminal (Main Overhaul)
Replace basic `<div>` with proper terminal emulator:
- Install `xterm` and `xterm-addon-fit` packages
- Create `<BuildTerminal />` React component
- Wire SSE streaming to xterm.js
- Handle ANSI color codes properly
- Auto-scroll and fit to container

### Hours 7-8: Polish & Safety Features
- **Progress indicators**: Show current phase (Planning → Implementing → Reviewing)
- **Cancel button**: Allow stopping running builds via Docker kill
- **Final testing**: Verify all modes work (turbo, budget, dry-run)

---

## Status

- [ ] Hour 1: Better Tool Call Display
- [ ] Hour 2: File Change Notifications
- [ ] Hour 3: Improved Error Handling
- [ ] Hour 4-6: xterm.js Terminal
- [ ] Hour 7-8: Polish & Safety

## Progress Log

| Date | Hours Worked | Items Completed |
|------|-------------|-----------------|
| 2026-03-01 | 2 | ✅ Hour 1: Better Tool Call Display, Hour 2: File Change Notifications, Hour 3: Improved Error Handling |
