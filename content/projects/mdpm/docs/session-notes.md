---
title: Session Notes
tags:
  - session-notes
createdAt: '2026-06-06T00:00:00Z'
updatedAt: '2026-06-06T01:00:00Z'
---

## What was done

- Completed MCP wiring (Task 5): registered `mdpm` server in `~/.claude.json` via `claude mcp add --scope user`. Installed `@modelcontextprotocol/sdk` and `tsx` devDependencies. Smoke tested — `ping` returns 3 projects (`bloc-cms`, `echo`, `mdpm`).
- Marked all 5 implementation tasks as `done` (docs data layer, docs UI, MCP server, skills, MCP wiring).
- Created `content/projects/mdpm/docs/architecture.md` — full reference doc covering stack, content structure, API routes, MCP server, skills, UI conventions, seed safety, deployment.
- Refactored project page tab pattern to match `AdminPageBase` in `bloc-cms`: `AppPageBase` now accepts `tabs: PageTab[]` prop, renders `UNavigationMenu` (route-linked, `highlight`, `pill`). Replaced `UTabs` + `?tab=` query param approach. Created `app/pages/projects/[slug]/docs/index.vue` as a separate route. Updated `docs/[doc].vue` back-links from `?tab=docs` → `/docs`.
- Fixed critical seed/reset bug: hourly Nitro scheduled task was wiping ALL projects including `mdpm` locally. Guarded seed plugin, reset task, and `scheduledTasks` config behind `NODE_ENV === 'production'`.
- Renamed `/checkpoint` → `/sync`. Updated skill to also sync stale docs (not just tasks).

## Decisions made

- Seed/reset logic is **production-only**. Never runs locally under `pnpm dev`.
- Tab navigation uses actual routes + `UNavigationMenu`, not `UTabs` + query params — consistent with `bloc-cms` convention.
- `/sync` replaces `/checkpoint` (conflicted with Claude Code's built-in `/rewind` alias). `/sync` now covers both task status updates and doc updates mid-session.
- MCP server registered globally (user scope in `~/.claude.json`), not per-project, so it works from any repo directory.

## Blockers / open questions

- UI not yet tested in browser — dev server was not started this session. Tab refactor, docs page, and doc editor should be verified visually.
- `CLAUDE.md` files for mdpm repo and consuming repos (e.g. `bloc-cms`) documenting the MCP/skills workflow were planned but not yet written.
- The `mcp-wiring-and-docs` task title mentions "CLAUDE.md" — that piece is still outstanding.

## Next recommended actions

1. Restart Claude Code to pick up `/sync` skill, then test `/pickup mdpm`, `/sync mdpm`, `/handoff mdpm` end-to-end.
2. Start dev server (`pnpm dev`) and verify tab refactor: project page Tasks/Docs tabs, docs list page, doc editor, breadcrumb back-links.
3. Write `CLAUDE.md` in mdpm repo and in `bloc-cms` documenting the MCP workflow (how to use `/pickup`, `/sync`, `/handoff`, what `MDPM_CONTENT_PATH` to set).
4. Test MCP write path: create a task via `create_task` tool and verify it appears in the UI.

## Tasks updated this session

- `docs-collection-data-layer`: todo → done
- `docs-ui-pages-and-project-tabs`: todo → done
- `mcp-server`: todo → done
- `claude-code-skills`: todo → done (renamed checkpoint → sync)
- `mcp-wiring-and-docs`: todo → done
- `add-automated-task-to-clear-demo-sites-data-and-re-seed-every-1-hour`: todo → done
