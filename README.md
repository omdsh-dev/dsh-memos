# dsh-memos

> [中文](README.zh.md) | **English**

Read your self-hosted [memos](https://usememos.com) notes from DeepSeek Harness sessions. Configure the server URL + a personal access token (PAT) once, then any agent can search, list, and read your notes through `memos_search` / `memos_list` / `memos_get`.

## Features

- **Settings panel** — configure the server URL and PAT in the web settings page (Settings → Memos): save, test connection, clear, plus a preview of your latest 5 memos.
- **memos_search** — keyword (content) and/or tag search; returns summaries (id, snippet, tags, time) with pagination and ordering.
- **memos_list** — browse recent notes, newest first, with `pageToken` pagination.
- **memos_get** — read one memo in full (content, tags, attachment list, timestamps).
- **memos_config** — set `serverUrl` and `accessToken`; `reset: true` clears credentials.
- **memos_status** — show configuration state and config path; never echoes the full token.
- Credentials persist to `~/.dsh/dsh-memos.json` (mode 0600).
- System-prompt announcement so agents know when to reach for this plugin.
- **Read-only by design** — no write/update/delete capability, minimizing the blast radius of a leaked PAT.

## Compatibility

Targets the memos **v0.x API** (`/api/v1/...`, verified against v0.30.0):
`GET /api/v1/memos` (list + CEL filter) and `GET /api/v1/memos/{id}` (single memo).

## Install

```sh
npm install && npm run build   # first time only: src/*.ts → lib/
dsh plugin --profile web add link:/path/to/dsh-memos
```

Restart `dsh web`. Source is TypeScript (`src/`); `lib/` is `tsc` output with zero runtime dependencies. During development use `npm run dev` (watch mode).

## Configure

1. In the memos web UI, open **Settings → Access Tokens** and create a personal access token.
2. In the DSH web settings page, open the **Memos** panel, paste your server URL (e.g. `https://memos.example.com`) and the token, then hit **Test connection** — or just ask the agent: "Configure memos: server https://..., token ...".
3. Then ask things like "search my memos for X", "list my 10 latest memos", "summarize notes tagged #ideas".

> A PAT is a read credential for your entire notebook. Keep it secret; if it leaks, delete it in memos and clear the local config via `memos_config(reset: true)` or the settings panel.

## License

MIT
