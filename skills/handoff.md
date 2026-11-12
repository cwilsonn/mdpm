---
description: Persist the current session's state to mdpm so the next session can pick up cleanly.
# Summarises the whole conversation into task notes and session notes: the one place a stronger model pays for itself.
model: opus
---
Persist the current session's state to mdpm so the next session can pick up cleanly.

Project: $ARGUMENTS

Tasks are written when work starts and when it ends, so the handoff records what ended. Use as few calls as possible: one batch for tasks, one write for the session notes.

Steps:
1. Ensure the mdpm server is running: `mdpm start` (idempotent and fast). On a non-zero exit output `> ⚠️ mdpm server did not start: <error>` and stop. Skip `ping`.
2. Review the conversation. Identify:
   - Tasks completed, started or blocked this session, and for each the one note worth keeping (what was done and why, decisions, verification, commits/PRs, as pointers)
   - Decisions made
   - Blockers encountered
   - What should happen next
3. Write all task changes with ONE call: `mdpm task batch --project $ARGUMENTS` with JSON on stdin, e.g. `[{"op":"update","ref":"<slug>","status":"done","note":"..."}]` (MCP fallback: `batch_tasks`). Do not confirm task by task; if the changes were already agreed in this conversation or by an earlier /sync, just apply them. Skip tasks whose status and note a /sync already recorded.
4. Write the session notes with `upsert_doc`: ONE doc per session, updated in place. Reuse the slug of the notes an earlier /sync wrote in this conversation; otherwise take the current datetime and use `<YYYY-MM-DD>-<HHmm>-session-notes`. Title `Session Notes — <YYYY-MM-DD> <HH:MM>`, tags `["session-notes"]`, body:
   ## What was done
   ## Decisions made
   ## Blockers / open questions
   ## Next recommended actions (ordered by priority)
   ## Tasks updated this session
   (slug, old status → new status)
   Keep it concise: the next /pickup reads at most the first ~2000 characters of it.
5. Confirm the writes succeeded and report any failures.
6. If `mdpm pickup $ARGUMENTS --json` reported a `compactionHint` (more than 10 session-notes docs), run `mdpm notes compact --project $ARGUMENTS` (a dry run) and offer the result to the user; never pass `--apply` without their yes.
7. Output only:
   > ✓ Session notes saved: http://mdpm.local:3333/projects/<project>/docs/<slug>
   Do NOT print the session-notes body. The link is sufficient for the user to verify.

Be honest and precise. Do not invent progress that didn't happen.
