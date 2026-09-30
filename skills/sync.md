Mid-session sync — update task statuses and write a dated session notes snapshot without a full handoff.

Project: $ARGUMENTS

Steps:
1. Call `ping` to confirm mdpm MCP is reachable. If it fails, output:
   > ⚠️ mdpm MCP server is unreachable. Check that MDPM_CONTENT_PATH is set correctly.
   Then stop.
2. Ensure the mdpm dev server is running: run `mdpm start` (idempotent: a no-op if it is already up).
   - On exit 0, continue.
   - On a non-zero exit, output: `> ⚠️ mdpm server did not start: <error from mdpm start>` Then stop.
3. Call `list_tasks` for the project with status `["todo", "in-progress", "in-review", "blocked"]`.
4. Call `list_docs` for the project to get current docs.
5. Review the conversation so far. For each task that has been touched or completed:
   - State the task slug, title, current status, and proposed new status
   - Ask for confirmation before writing: "Update <title> from <old> → <new>? (y/n)"
6. For confirmed task updates, call `update_task`. Confirm each write.
7. Review docs for the project. If any doc (other than session-notes) is stale or should be updated based on work done this session:
   - State the doc slug, title, and what should change
   - Ask for confirmation before writing: "Update doc '<title>'? (y/n)"
8. For confirmed doc updates, call `upsert_doc` with the updated content.
9. Determine the current datetime. Write a session snapshot using `upsert_doc` with:
   - project: the project slug
   - slug: "<YYYY-MM-DD>-<HHmm>-session-notes" (e.g. "2026-06-09-1430-session-notes") — always a new slug, never overwrite
   - title: "Session Notes — <YYYY-MM-DD> <HH:MM>"
   - tags: ["session-notes"]
   - body: A brief markdown snapshot with sections:
     ## Progress so far
     ## Open questions / blockers
     ## Next steps
   Always create a new doc — each /sync call produces a new timestamped entry.
10. Output only:
    > ✓ Synced. Session notes: http://mdpm.local:3333/projects/<project>/docs/<slug>
    Then list: tasks updated (count), docs updated (count), open tasks remaining (count).
    Do NOT print the session-notes body.
