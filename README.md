# OpenClaw Agent Workspace

Next.js + OpenClaw gateway chat workspace with:
- multiple agents
- multiple chats per agent
- streaming responses (SSE)
- image attachments
- per-agent workspace bootstrap files (`AGENTS.md`, `SOUL.md`, etc.)

## Quick Start

1. Copy env:
```bash
cp .env.example .env
```
2. Set required values in `.env`:
- `OPENCLAW_GATEWAY_TOKEN`
- one provider key:
  - `ANTHROPIC_API_KEY` for Claude models
  - `OPENAI_API_KEY` for OpenAI models
3. Start:
```bash
docker compose up --build
```
4. Open:
- [http://localhost:3000](http://localhost:3000)

## Troubleshooting

- If chat fails with OpenClaw websocket connection failed (socket-error), recreate containers with a clean build:
  - `docker compose down`
  - `docker compose up --build`
- Gateway is started with `--bind lan`, so app container can reach `ws://openclaw:18789` on Docker networks (including Windows).
- On startup, compose seeds OpenClaw config (mode/bind/auth token + allowed origins) before running gateway.
- For empty `openclaw-data` runs, startup does two things before UI serves traffic:
  - app creates/loads `openclaw-data/identity/device.json`
  - app runs `prepair-openclaw.mjs` to wait until that device is approved
- Auto-approval is still enabled on gateway side (`OPENCLAW_AUTO_APPROVE_PENDING_DEVICES=true`).
- If first startup is slow on your machine, increase:
  - `OPENCLAW_PREPAIR_MAX_WAIT_MS`
  - `OPENCLAW_AUTO_APPROVE_TIMEOUT_MS`
- If connection succeeds but generation fails with `401 authentication_error`, your provider key is invalid/missing.

## Module Layout

- App: `app/`
  - Next.js UI + API routes
  - app-level schemas and request validation (`app/src/modules/app/schemas/*`)
- OpenClaw module: `openclaw/`
  - gateway websocket protocol + stream orchestration
  - session/runtime key helpers
  - agent workspace bootstrap logic
- API routes (`app/src/app/api/*`) are thin adapters that call `@openclaw/module`.

## Important Runtime Notes

- OpenClaw data is mounted at `./openclaw-data`.
- Runtime artifacts are intentionally ignored in git (`openclaw-data/*`).
- New agents create/update runtime folders/files automatically, for example:
  - `openclaw-data/agents/<agent-id>/sessions`
  - `openclaw-data/workspace-agent-<agent-key>/AGENTS.md`
  - `openclaw-data/workspace-agent-<agent-key>/IDENTITY.md`
  - `openclaw-data/workspace-agent-<agent-key>/memory/YYYY-MM-DD.md`

## Main API Routes

- `POST /api/chat` - stream assistant responses
- `POST /api/agents/bootstrap` - create/update agent workspace runtime files
- `GET/POST /api/config` - read/update gateway config
- `GET /api/health` - gateway readiness
