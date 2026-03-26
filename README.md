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
- `ANTHROPIC_API_KEY`
- `OPENCLAW_GATEWAY_TOKEN`
3. Start:
```bash
docker compose up --build
```
4. Open:
- [http://localhost:3000](http://localhost:3000)

## Important Runtime Notes

- OpenClaw data is mounted at `./openclaw-data`.
- Runtime artifacts are intentionally ignored in git (`openclaw-data/*`).
- New agents create/update runtime folders/files automatically, for example:
  - `openclaw-data/agents/<agent-id>/sessions`
  - `openclaw-data/workspace-agent-<agent-key>/AGENTS.md`
  - `openclaw-data/workspace-agent-<agent-key>/IDENTITY.md`
  - `openclaw-data/workspace-agent-<agent-key>/memory/YYYY-MM-DD.md`

## Default Agents

The app currently ships with starter agents:
- Career Manager
- Moldova PDD + Law
- JS Guru

You can create custom agents from the sidebar UI.

## Main API Routes

- `POST /api/chat` - stream assistant responses
- `POST /api/agents/bootstrap` - create/update agent workspace runtime files
- `GET/POST /api/config` - read/update gateway config
- `GET /api/health` - gateway readiness
