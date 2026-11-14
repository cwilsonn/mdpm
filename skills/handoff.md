---
description: Record this session's work in mdpm (task statuses and notes in one batch, session notes in one doc). Safe to run mid-session and again at the end.
# Summarises the whole conversation into task notes and session notes: the one place a stronger model pays for itself.
model: opus
---
Record this session's work in mdpm so the next session can pick up cleanly. Run it whenever a chunk of work is finished and again at the end: each run updates the same session-notes doc and skips what an earlier run already recorded.

Project: $ARGUMENTS (if empty, the CLI infers it from the current repo)

Use as few calls as possible: one batch for tasks, one write for the session notes.

Steps:
1. Writes need the server: run `mdpm start` (idempotent, a no-op when it is already up). On a non-zero exit output `> ⚠️ mdpm server did not start: <error>` and stop.
2. Review the conversation since the last handoff in it (or since the start). Identify:
   - Tasks finished, started or blocked, each with its one note worth keeping: what was done and why, decisions, how it was verified, commits and PR URLs (pointers, not copies). Tasks that were started but not finished get their status only.
   - Docs made stale by this session's work.
   - Decisions, blockers, and what should happen next.
3. If the user has not already agreed these changes (in this conversation or in their request, e.g. "/handoff and mark X done"), show them in ONE compact list and ask ONCE: "Apply these N updates? (y / edit)".
4. Apply every task change with ONE call: `mdpm task batch --project $ARGUMENTS` with JSON on stdin, e.g. `[{"op":"update","ref":"<slug>","status":"done","note":"..."},{"op":"create","title":"...","status":"in-progress"}]` (MCP: `batch_tasks`). Report only counts and failed items.
5. Update the stale docs the user confirmed (`mdpm doc edit` / `upsert_doc`).
6. Session notes: ONE doc per session, updated in place. Reuse the slug if an earlier handoff in this conversation wrote one; otherwise use `<YYYY-MM-DD>-<HHmm>-session-notes` from the current datetime, title `Session Notes — <YYYY-MM-DD> <HH:MM>`, tags `["session-notes"]`. Write it with `upsert_doc` (creates or replaces by slug). Body, concise (the next /pickup reads about the first 2000 characters):
   ## What was done
   ## Decisions made
   ## Blockers / open questions
   ## Next recommended actions (ordered by priority)
   ## Tasks updated this session
   (slug, old status → new status)
7. If `mdpm pickup $ARGUMENTS --json` reports a `compactionHint`, run `mdpm notes compact --project $ARGUMENTS` (a dry run) and offer the result; never pass `--apply` without the user's yes.
8. Output only:
   > ✓ Handoff saved: <n> tasks updated, session notes `<project>/<slug>`.
   Do NOT print the session-notes body.

Be honest and precise. Do not invent progress that didn't happen.
