# Architecture

## Overview

The project uses two runtime services:

- `openclaw`: the gateway and model orchestration layer
- `frontend`: a single Next.js application that serves the browser UI and the server-side API routes

The browser never connects directly to the OpenClaw websocket. All gateway traffic stays server-side inside the Next.js app.

## Request Flow

1. The user submits a prompt in the Next.js chat UI.
2. The browser sends `POST /api/chat`.
3. The Next.js route handler opens a websocket connection to the OpenClaw gateway.
4. The handler completes the gateway challenge-response handshake.
5. The handler sends `chat.send`.
6. The handler listens for `chat` events and forwards them to the browser as SSE messages.
7. The browser consumes the SSE stream and updates the in-progress assistant message incrementally.

## Key Decisions

### Single Next.js app instead of a separate backend service

This reduces operational complexity for the assessment:

- one app owns both UI and API behavior
- no cross-service application API contract is needed
- the server-side gateway logic stays close to the streaming UI

### Server-mediated streaming

Streaming is implemented from OpenClaw to Next.js over WebSocket, then from Next.js to the browser over SSE. That keeps secrets server-side and avoids exposing the raw gateway protocol in the browser.

### OpenClaw identity reuse

The frontend container mounts `./openclaw-data` read-only and reuses the OpenClaw identity file generated under `openclaw-data/identity/device.json`.

Trade-off:

- Pro: avoids a second application service just to manage a websocket bridge
- Pro: keeps `docker compose up --build` simple
- Con: the Next.js server is coupled to OpenClaw state layout
- Con: this is practical for the assessment stack, but not the cleanest boundary for a production multi-service deployment

## Trade-offs

### Why no direct browser websocket to OpenClaw

That would expose gateway auth and handshake logic to the client. The chosen design keeps auth, device signing, and protocol normalization on the server.

### Why SSE to the browser

SSE is enough for one-way assistant streaming and is simpler than adding a second browser websocket layer.

### Why the model is configured in OpenClaw

The Next.js app stays protocol-focused. Model routing and provider concerns remain in the gateway config where they belong.
