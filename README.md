# OpenClaw Chat Assessment

This repository contains a Dockerized chat application for the OpenClaw technical assessment. The UI and API both live in a single Next.js app, and the server-side route handlers connect to the OpenClaw gateway over WebSocket so assistant output can stream into the browser as it is generated.

## Stack

- OpenClaw running in Docker
- Next.js 16 App Router for both frontend and backend
- Server-side streaming from Next route handlers to the browser with SSE
- Anthropic Claude Sonnet 4.5 configured as the default OpenClaw model

## Prerequisites

- Docker with `docker compose`
- An Anthropic API key

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in:
   - `ANTHROPIC_API_KEY`
   - `OPENCLAW_GATEWAY_TOKEN`

## Run

```bash
docker compose up --build
```

Then open [http://localhost:3000](http://localhost:3000).

## How It Works

- The `openclaw` service mounts `./openclaw-data` and reads `openclaw-data/openclaw.json`.
- The Next.js service talks to `ws://openclaw:18789` from server route handlers, not from the browser.
- The frontend container mounts `./openclaw-data` read-only and reuses the gateway identity file created by OpenClaw at `openclaw-data/identity/device.json`.
- `POST /api/chat` performs the OpenClaw handshake, sends `chat.send`, and forwards `chat` events to the browser as an SSE stream.
- The browser reads that SSE stream incrementally and updates the assistant message in place.

## Verification

These checks passed locally in this workspace:

- `npm run lint` inside `frontend`
- `npm run build` inside `frontend`

I could not run a full local HTTP smoke test from the sandbox because binding a port is blocked here, but the production build completed successfully.

## Deliverables

- Docker Compose stack: [docker-compose.yml](/Users/ionleu/projects/104-openclaw-challenge/docker-compose.yml)
- OpenClaw config: [openclaw-data/openclaw.json](/Users/ionleu/projects/104-openclaw-challenge/openclaw-data/openclaw.json)
- Architecture write-up: [ARCHITECTURE.md](/Users/ionleu/projects/104-openclaw-challenge/ARCHITECTURE.md)
- Changelog: [CHANGELOG.md](/Users/ionleu/projects/104-openclaw-challenge/CHANGELOG.md)
