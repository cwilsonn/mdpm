# mdpm

Markdown-based project management tool. Nuxt 4 app that stores projects, tasks, and docs as markdown files in `content/`. Exposes an MCP server for Claude Code integration.

## Setup

**Node 24 required** (`.nvmrc` pins it). `better-sqlite3` is a native module — if you switch Node versions, run `pnpm rebuild better-sqlite3`.

```sh
nvm use
pnpm install
pnpm dev       # http://mdpm.local:3333
```

Add to `/etc/hosts` if not present:
```
127.0.0.1 mdpm.local
```

## Stack

- **Nuxt 4** (`compatibilityVersion: 4`, `app/` dir layout — `app.config.ts` lives at `app/app.config.ts`)
- **@nuxt/content v3** — file-based markdown, SQLite cache, `queryCollection()`
- **@nuxt/ui v4** — `UNavigationMenu`, `UModal`, `UInputTags`, etc.
- **Nitro server routes** — server-side utils auto-imported: `writeMarkdown`, `contentPath`, `slugify`, `uniqueSlug`, `readMarkdown`, `deleteContent`

## Content Structure

```
content/
  projects/
    <slug>/
      index.md          # project metadata (frontmatter only)
      tasks/
        <slug>.md       # task: frontmatter + markdown body
      docs/
        <slug>.md       # reference doc: frontmatter + markdown body
```

Collections defined in `content.config.ts`: `projects`, `tasks`, `docs`.

## API Routes

### Tasks
- `GET /api/tasks` — all tasks (filter: `?project=`, `?status=`, `?priority=`, `?tags=`)
- `POST /api/tasks` — create task
- `PATCH /api/tasks/[project]/[slug]` — update task
- `DELETE /api/tasks/[project]/[slug]` — delete task

### Docs
- `GET /api/docs` — all docs (filter: `?project=`)
- `POST /api/docs/[project]` — create doc
- `GET /api/docs/[project]/[slug]` — get doc with body
- `PATCH /api/docs/[project]/[slug]` — update doc
- `DELETE /api/docs/[project]/[slug]` — delete doc

## MCP Server

Location: `mcp/index.ts` (runs via `tsx`, no build step).

**Read tools** query markdown files directly — no dev server needed.  
**Write tools** call the Nuxt HTTP API — dev server must be running.

Registered globally: `~/.claude.json` under `mcpServers.mdpm`.

Required env vars (set in shell profile or `.env`):
- `MDPM_CONTENT_PATH` — absolute path to `content/` dir (e.g. `/Users/cody/dev/mdpm/content`)
- `MDPM_BASE_URL` — base URL of running Nuxt app (default: `http://mdpm.local:3333`)

Tools: `ping`, `list_projects`, `get_project`, `list_tasks`, `get_task`, `create_task`, `update_task`, `list_docs`, `get_doc`, `search_docs`, `upsert_doc`

## Claude Code Skills

Global skills in `~/.claude/commands/`:

| Skill | When to use |
|-------|-------------|
| `/start-mdpm` | Start dev server (idempotent — safe to call if already running) |
| `/stop-mdpm` | Stop dev server |
| `/pickup <project>` | Start of session — loads open tasks, docs, last session notes |
| `/sync` | Mid-session — sync task statuses + update stale docs |
| `/handoff` | End of session — writes `session-notes` doc, marks tasks done |

## UI Conventions

Project pages use route-linked tabs via `AppPageBase`:
- `/projects/[slug]` — Tasks tab (`exact: true`)
- `/projects/[slug]/docs` — Docs tab
- `/projects/[slug]/docs/[doc]` — Inline doc editor

`AppPageBase` accepts `tabs: PageTab[]`; renders `UNavigationMenu` with `highlight` + `pill`. Do not use `UTabs` + `?tab=` query params for project-level navigation.

## Seed / Reset Safety

Seed plugin (`server/plugins/seed.ts`) and hourly reset task (`server/tasks/reset.ts`) are **production-only** — both guard on `process.env.NODE_ENV === 'production'`. Running `pnpm dev` locally will never seed or reset data.

## Deployment

Railway. Persistent volume at `/app/content`. Start command: `node .output/server/index.mjs`. Required env: `NODE_ENV=production`.
