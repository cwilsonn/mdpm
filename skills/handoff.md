Persist the current session's state to mdpm so the next session can pick up cleanly.

Project: $ARGUMENTS

Steps:
1. Call `ping` to confirm mdpm MCP is reachable. If it fails, output:
   > ⚠️ mdpm MCP server is unreachable. Check that MDPM_CONTENT_PATH is set correctly.
   Then stop — do not continue silently.
2. Check that the mdpm dev server is running by fetching http://mdpm.local:3333.
   - If it responds, continue.
   - If not, start it automatically:
     - Run `pnpm --dir /Users/cody/dev/projects/mdpm dev` in the background.
     - Poll http://mdpm.local:3333 every 2s for up to 15 seconds.
     - If it comes up, output: `> ✓ mdpm started, continuing…` and proceed.
     - If it doesn't come up in 15s, output: `> ⚠️ mdpm did not start in time. Check the terminal for errors.` Then stop.
3. Review the conversation. Identify:
   - Tasks that were completed, started, or updated this session
   - Decisions made
   - Blockers encountered
   - What should happen next
4. For each task with a status change, call `update_task` with the new status. Confirm each write.
5. Determine the current datetime. Write a session summary doc using `upsert_doc` with:
   - project: the project slug
   - slug: "<YYYY-MM-DD>-<HHmm>-session-notes" (e.g. "2026-06-09-1430-session-notes") — always a new slug
   - title: "Session Notes — <YYYY-MM-DD> <HH:MM>"
   - tags: ["session-notes"]
   - body: A concise markdown summary with sections:
     ## What was done
     ## Decisions made
     ## Blockers / open questions
     ## Next recommended actions (ordered by priority)
     ## Tasks updated this session
     (list slug, old status → new status)
   Each session creates a new dated doc — do not reuse a slug from a previous session.
6. Confirm all writes succeeded. Report any failures.
7. Output only:
   > ✓ Session notes saved: http://mdpm.local:3333/projects/<project>/docs/<slug>
   Do NOT print the session-notes body. The link is sufficient for the user to verify.

Be honest and precise. Do not invent progress that didn't happen.
