# Changelog

## Unreleased

- Add image attachment support from composer to OpenClaw `chat.send.attachments`.
- Add tool-call timeline streaming/rendering (running/completed/error + args/output).
- Add programmatic config generator API (`GET/POST /api/config`) and sidebar UI.
- Add stronger stream deduplication/merge logic to avoid oversized transient text renders.
- Add broader request/stream/tool/config structured logs.
- Update docs (`README`, `ARCHITECTURE`) for new functionality.

## 2026-03-26

- `7f9b055` `chore: initialize repo and scaffold backend package`
- `7eddd4a` `chore: configure openclaw gateway for docker setup`
- `3557b0f` `feat: build Next.js chat app with OpenClaw streaming`
- `e3c7a63` `docs: add assessment documentation`
- `803b83d` `chore: add structured api and gateway logs`
- `84e160a` `feat: redesign chat ui with sidebar history layout`
- `cfe7527` `feat: add multi-agent chats with isolated sessions`
- `e7253e8` `feat: render assistant messages as markdown`
- `05ea082` `feat: redesign chat workspace with stronger visual hierarchy`
- `0ecbe0e` `fix: handle cumulative stream deltas without text rollback`
- `8691716` `fix: render markdown only after stream completes`
- `e199acd` `fix: parse openclaw delta payloads without duplicated snapshots`
- `9e23faf` `refactor: split chat shell into feature modules`
