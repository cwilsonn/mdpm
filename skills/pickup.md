Load context for the given project from mdpm and produce a structured session briefing.

Project: $ARGUMENTS

Steps:
1. Call the `ping` tool to confirm mdpm MCP is reachable. If it fails, output:
   > ⚠️ mdpm MCP server is unreachable. Check that MDPM_CONTENT_PATH is set correctly.
   Then stop.
2. Note: read operations work without the mdpm dev server running. Write operations (update_task, upsert_doc) require it at http://mdpm.local:3333 — warn the user if they plan to use /sync or /handoff this session.
3. Call `list_tasks` with the project slug and status filter `["todo", "in-progress", "in-review", "blocked"]` to get all open work.
4. Call `list_docs` with the project slug to get all reference docs.
5. From the doc list, find docs tagged `session-notes`. Sort by slug descending (slugs are `YYYY-MM-DD-session-notes`); call `get_doc` on the most recent one to retrieve last session's handoff notes.
6. Produce a structured briefing in this format:

---
## Session Briefing: <project>

### Open Tasks (<count>)
Group by status: in-progress first, then blocked, then in-review, then todo.
For each task: slug, title, priority, any relevant context from description (1 line max).

### Docs (<count>)
List each doc: title, slug, one-line summary from excerpt.
Flag any doc tagged `architecture`, `decisions`, or `context` as high-priority reading.

### Last Session Notes
If session-notes doc exists, include its full body here.
If not, note: "No previous session notes found."

### Suggested Focus
Based on open tasks and priorities, suggest 1-3 tasks to tackle this session.
Ask: "What would you like to work on?"
---

Keep the briefing factual. Do not embellish or add tasks that aren't in mdpm.
