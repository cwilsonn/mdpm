# .mdpm

A local-first, markdown-based project management tool. Tasks and docs live as plain `.md` files in a `content/` directory — portable, git-friendly, and readable without the app. Built on Nuxt 4 + `@nuxt/content` + `@nuxt/ui`.

## Demo / Sandbox

Live on Railway (resets hourly with fresh demo data):
**https://mdpm-production-2440.up.railway.app/**

Feel free to poke around — create projects, drag tasks between columns, write docs. It'll wipe itself clean every hour.

## What it does

- **Projects** — create and manage projects with status, tags, description, and a custom icon
- **Tasks** — kanban board per project (todo / in-progress / in-review / blocked / done), drag to reorder and move between columns, priority levels, assignees, dependencies, due dates, markdown descriptions
- **Docs** — reference docs per project with a rich text editor; also a global searchable/filterable docs page across all projects
- **MCP server** — local stdio MCP server (`mcp/index.ts`) so Claude Code can read and write your projects, tasks, and docs directly

## Stack

- [Nuxt 4](https://nuxt.com) (`compatibilityVersion: 4`)
- [@nuxt/content v3](https://content.nuxt.com) — file-based markdown with SQLite cache
- [@nuxt/ui v4](https://ui.nuxt.com) — component library
- [Tiptap](https://tiptap.dev) — rich text editor
- [vue-draggable-plus](https://github.com/Alfred-Skyblue/vue-draggable-plus) — drag-and-drop kanban
- [gray-matter](https://github.com/jonschlinkert/gray-matter) — frontmatter parsing (used by MCP server)

## Local setup

Setting up on another machine (CLI, MCP server, Claude Code skills)? See [INSTALL.md](INSTALL.md).

```bash
pnpm install
pnpm dev
```

Dev server runs at `http://mdpm.local:3333`. Add this to `/etc/hosts` first:

```
127.0.0.1 mdpm.local
```

On first run with an empty `content/` directory the app won't auto-seed locally — that only happens in production. Add your first project via the UI.

## Content structure

Everything lives in `content/`:

```
content/
  projects/
    <slug>/
      index.md        # project metadata (title, status, icon, tags, description)
      tasks/
        <slug>.md     # task (status, priority, assignees, deps, order + markdown body)
      docs/
        <slug>.md     # reference doc (title, tags + markdown body)
```

You can edit these files directly in any editor — the app picks up changes automatically.

## MCP server

The MCP server lets Claude Code read and write mdpm data from any project you're working on.

### Setup

1. Add `127.0.0.1 mdpm.local` to `/etc/hosts`
2. Register the server (already done if you're using this repo):
   ```bash
   claude mcp add mdpm --scope user -- /path/to/mdpm/node_modules/.bin/tsx /path/to/mdpm/mcp/index.ts
   ```
3. Set env vars in `~/.claude.json` under `mcpServers.mdpm.env`:
   ```json
   {
     "MDPM_CONTENT_PATH": "/absolute/path/to/mdpm/content",
     "MDPM_BASE_URL": "http://mdpm.local:3333"
   }
   ```

Read operations (list/get tasks and docs) work without the dev server running. Write operations require it.

### Tools

`ping` · `list_projects` · `get_project` · `list_tasks` · `get_task` · `create_task` · `update_task` · `list_docs` · `get_doc` · `search_docs` · `upsert_doc`

## Claude Code skills

Three global skills for session-to-session PM handoff. Lives in `~/.claude/commands/`.

| Skill | When |
|---|---|
| `/pickup <project>` | Start of session — briefing with open tasks, docs, last session notes |
| `/sync <project>` | Mid-session — confirm task status updates + stale doc updates |
| `/handoff <project>` | End of session — write task updates + `session-notes` doc for next session |
| `/start-mdpm` | Start the dev server in the background if it's not already running |

`session-notes` is a reserved doc slug that gets overwritten each session. Git history is the log.

## Deployment

Deployed via Railway. Requires a persistent volume mounted at `/app/content` so data survives deploys.

```toml
# railway.toml
[deploy]
startCommand = "node .output/server/index.mjs"
healthcheckPath = "/"
restartPolicyType = "on_failure"
```

Required env vars on Railway:
- `NODE_ENV=production` — enables hourly demo reset + auto-seed on empty volume
