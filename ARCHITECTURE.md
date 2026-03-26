# Architecture

## Overview

The project uses two runtime services:

- `openclaw`: the gateway and model orchestration layer
- `app`: a single Next.js application that serves the browser UI and server-side API routes

The repository is split into two code modules:

- `app/`: Next.js app code (UI + API adapters + app-level schemas)
- `openclaw/`: reusable OpenClaw integration module (gateway/session/workspace logic)

The browser never connects directly to OpenClaw websocket. All gateway traffic stays server-side in the Next.js app.

## Request Flow

1. User submits a prompt in the chat UI.
2. Browser sends `POST /api/chat` to the app.
3. API route calls `@openclaw/module` server logic.
4. Module opens websocket connection to OpenClaw gateway.
5. Module performs challenge-response handshake and signs device payload.
6. Module sends `sessions.patch` + `chat.send`.
7. Module normalizes `chat` and `agent` events.
8. Route streams normalized SSE events back to the browser.

## Runtime State

Runtime-generated state is under `openclaw-data/` and is gitignored:

- `openclaw-data/identity/device.json` (device identity)
- `openclaw-data/openclaw.json` (gateway config)
- `openclaw-data/agents/*/sessions/*` (chat session state)
- `openclaw-data/workspace-agent-*/...` (agent workspace files and memory)

`app/scripts/bootstrap-identity.mjs` ensures identity file exists at startup.

## Key Decisions

- Keep a single Next.js runtime service for this project scope.
- Keep OpenClaw protocol logic outside app routes in a dedicated module.
- Use WebSocket (app -> OpenClaw) + SSE (app -> browser) to keep auth and handshake server-side.
- Keep runtime data mounted via `openclaw-data` volume so identity and sessions persist across restarts.
