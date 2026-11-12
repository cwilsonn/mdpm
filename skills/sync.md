---
description: Mid-session sync — record finished work in mdpm in one batch and update the session notes, without a full handoff.
# Summarises the whole conversation into task notes and session notes: the one place a stronger model pays for itself.
model: opus
---
Mid-session sync — record finished work in mdpm in one batch and update the session notes, without a full handoff.

Project: $ARGUMENTS

Tasks are written when a unit of work starts and when it ends, never in between, so this is where finished work gets its status and its one note. Keep the number of calls small: one batch for tasks, one write for docs.

Steps:
1. Ensure the mdpm server is running: `mdpm start` (idempotent and fast: a no-op if it is already up). On a non-zero exit output `> ⚠️ mdpm server did not start: <error>` and stop. Skip `ping`; this call proves reachability.
2. Reads need no server. Get the open tasks with `mdpm pickup $ARGUMENTS --json` (capped, one call) rather than listing tasks and docs separately. If the project argument is empty the CLI infers it from the repo.
3. From the conversation so far, work out which tasks were touched or finished. For each: slug, current status, proposed status, and a note. A note says what was done and why, decisions, how it was verified, and commits/PRs, as pointers rather than copies. Tasks that were started but not finished get their status only (no note).
4. Show all proposed changes in ONE message as a compact list and ask ONCE: "Apply these N updates? (y / edit)". If the user's request already said what to do (e.g. "/sync and mark X done"), apply it without asking again; confirmation is only for changes the user has not seen.
5. Apply every confirmed task change with a single call:
   `mdpm task batch --project $ARGUMENTS` with JSON on stdin, e.g. `[{"op":"update","ref":"<slug>","status":"done","note":"..."},{"op":"create","title":"...","status":"in-progress"}]`.
   (MCP fallback: the `batch_tasks` tool.) Report only the counts and any failed items.
6. Docs other than session notes that are stale because of this session: list them in the same message as step 4 and apply confirmed ones with `mdpm doc edit` / `upsert_doc`.
7. Session notes: ONE doc per session, updated in place. If this session already wrote one (an earlier /sync in this conversation), reuse its slug; otherwise take the current datetime and use slug `<YYYY-MM-DD>-<HHmm>-session-notes`, title `Session Notes — <YYYY-MM-DD> <HH:MM>`, tags `["session-notes"]`. Write it with `upsert_doc` (it creates or replaces by slug) with a brief body:
   ## Progress so far
   ## Open questions / blockers
   ## Next steps
   Remember the slug in the conversation so /handoff reuses it.
8. Output only:
   > ✓ Synced. Session notes: http://mdpm.local:3333/projects/<project>/docs/<slug>
   Then: tasks updated (count), docs updated (count), open tasks remaining (count). Do NOT print the session-notes body.
