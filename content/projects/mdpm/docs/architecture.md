---
title: Architecture & MCP Workflow
tags:
  - architecture
  - mcp
  - context
createdAt: '2026-06-05T00:00:00Z'
updatedAt: '2026-06-06T01:00:00.000Z'
---
## Stack

- **Nuxt 4** (`compatibilityVersion: 4`, `app/` dir layout)
- **@nuxt/content v3** — file-based markdown, SQLite cache, `queryCollection()`
- **@nuxt/ui v4** — UNavigationMenu, UModal, UInputTags, etc.
- **Nitro server routes** — auto-imports: `writeMarkdown`, `contentPath`, `slugify`, `uniqueSlug`, `readMarkdown`, `deleteContent`

## Content Structure

```
content/
  projects/
    <slug>/
      index.md          # project metadata
      tasks/
        <slug>.md       # task with frontmatter + markdown body
      docs/
        <slug>.md       # reference doc with frontmatter + markdown body
```

## Collections

Defined in `content.config.ts`:
- `projects` — project index files
- `tasks` — all tasks across projects (`projects/*/tasks/*.md`)
- `docs` — all docs across projects (`projects/*/docs/*.md`)

## API Routes

### Tasks
- `GET /api/tasks` — all tasks (filterable by project, status, priority, tags)
- `GET /api/tasks/[project]` — tasks for one project
- `POST /api/tasks` — create task
- `PATCH /api/tasks/[project]/[slug]` — update task
- `DELETE /api/tasks/[project]/[slug]` — delete task

### Docs
- `GET /api/docs` — all docs (filterable by `?project=`)
- `GET /api/docs/[project]` — docs for one project
- `POST /api/docs/[project]` — create doc
- `GET /api/docs/[project]/[slug]` — get single doc (includes `body`)
- `PATCH /api/docs/[project]/[slug]` — update doc
- `DELETE /api/docs/[project]/[slug]` — delete doc

## MCP Server

Location: `mcp/index.ts`  
Runner: `tsx` (TypeScript, no build step)  
Transport: stdio

**Read tools** query files directly via `gray-matter` (no HTTP needed, works without dev server).  
**Write tools** call the Nuxt HTTP API (keeps slug/validation logic in one place).

Registered globally in `~/.claude.json` under `mcpServers.mdpm`.

**Required env vars:**
- `MDPM_CONTENT_PATH` — absolute path to `content/` dir
- `MDPM_BASE_URL` — base URL of running Nuxt app (default: `http://mdpm.local:3333`)

**Tools:** `ping`, `list_projects`, `get_project`, `list_tasks`, `get_task`, `create_task`, `update_task`, `list_docs`, `get_doc`, `search_docs`, `upsert_doc`

## Claude Code Skills

Global skills in `~/.claude/commands/`:

| Skill | When to use |
|-------|-------------|
| `/pickup <project>` | Start of session — loads open tasks, docs, last session notes |
| `/handoff <project>` | End of session — updates task statuses, writes `session-notes` doc |
| `/sync <project>` | Mid-session — task status sync + stale doc updates |

`session-notes` doc slug is overwritten each session; git history is the log.

## UI Conventions

Project pages use route-linked tabs via `AppPageBase` (mirrors `AdminPageBase` in bloc-cms):
- `/projects/[slug]` — Tasks tab (kanban, `exact: true` match)
- `/projects/[slug]/docs` — Docs tab (list + create)
- `/projects/[slug]/docs/[doc]` — Full-page inline editor (breadcrumb back to docs tab)

`AppPageBase` accepts a `tabs: PageTab[]` prop; renders `UNavigationMenu` with `highlight` + `pill` below the navbar. Do not use `UTabs` + query params for project-level navigation.

## Seed / Reset Safety

Seed plugin (`server/plugins/seed.ts`) and hourly reset task (`server/tasks/reset.ts`) are **production-only** — both guard on `process.env.NODE_ENV === 'production'`. The scheduled task is also only registered in `nuxt.config.ts` when `NODE_ENV === 'production'`. Running `pnpm dev` locally will never trigger seed or reset.

## Deployment

Deployed on Railway. Persistent volume at `/app/content`.  
Start command: `node .output/server/index.mjs`  
Required env: `NODE_ENV=production`

Dev server runs at `http://mdpm.local:3333` (add `127.0.0.1 mdpm.local` to `/etc/hosts`). Port 3333 avoids collisions with other Nuxt/Vite projects on 3000.

For consuming repos (e.g. `bloc-cms`): MCP server reads from the local `content/` path, so mdpm dev server does **not** need to be running for read operations. Write operations (task/doc mutations) require the Nuxt app running at `MDPM_BASE_URL`. Use `/start-mdpm` skill to start it if down.
