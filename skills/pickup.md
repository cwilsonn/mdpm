Load context for the given project from mdpm and produce a structured session briefing.

Project: $ARGUMENTS

Steps:
1. Run `mdpm pickup $ARGUMENTS --json` (if no project was given, the CLI infers it from the current repo). One call returns everything, capped: open tasks grouped by status (8 per status, "+N more" beyond), blockers, what changed since the last handoff, docs, the latest session notes (2000 chars), and a rule-based focus suggestion. Use `mdpm pickup $ARGUMENTS --delta` for only the changes since the last handoff, `--full` to lift the caps.
   - Exit 4: the project doesn't exist in mdpm. Output `> ⚠️ mdpm has no project matching "<project>".` Then stop.
   - Exit 2 (ambiguous or no project): show the CLI's error and stop.
   - `mdpm: command not found`, or any other failure: use the **Fallback** below instead.
2. Note: reads work without the dev server. Writes (`update_task`, `upsert_doc`, `mdpm task ...`) need it running at http://mdpm.local:3333 (`mdpm status` checks it, `mdpm start` starts it). Warn the user if they plan to use /sync or /handoff this session and it is down (they run `mdpm start` themselves, which is fast and idempotent).
3. Produce a structured briefing in this format, using only what the JSON contains:

---
## Session Briefing: <project>

### Since last session
If `sinceLastSession` has changes, list them in one line each (`changes`, plus `moreChanges` and `docsChanged`). Status changes are not recorded, so "updated" shows the current status.

### Blockers
List `blockers` (slug and reason). Omit the section when empty.

### Open Tasks (<openTaskCount>)
Group by status: in-progress first, then blocked, then in-review, then todo (`tasks`).
For each task: slug, title, priority, and its `summary` (1 line max). If `hiddenTasks` says more exist, say so and name the command (`mdpm task list --status <status>`); do not fetch them unless asked.

### Docs (<docCount>)
List each doc in `docs`: title, slug, one-line `summary`.
Flag any doc with `highPriority` (tagged `architecture`, `decisions`, or `context`) as high-priority reading.
Mention `sessionNotesCount` session-notes docs in one line; don't list them.

### Last Session Notes
If `lastSessionNotes` is set, include its `body` here. If `truncated` is true, say it was cut and name `mdpm doc show <slug> --offset <n>`; do not read the rest unless asked.
If not, note: "No previous session notes found."

### Suggested Focus
Start from `suggestedFocus` (in-progress first, then todo by priority). Adjust using the last session's "next actions" if they point elsewhere, and suggest 1-3 tasks.
Ask: "What would you like to work on?"
---

Keep the briefing factual. Do not embellish or add tasks that aren't in mdpm.

Fallback (MCP only, when the CLI is unavailable):
1. Call the `ping` tool. If it fails, output:
   > ⚠️ mdpm MCP server is unreachable. Check that MDPM_CONTENT_PATH is set correctly.
   Then stop.
2. Call the `pickup` tool with the project slug. It returns the same JSON as the CLI, capped, and picks the newest session notes itself.
3. Produce the same briefing as above from the result.
