<!-- mdpm:work-logging:start -->
## Work logging (mdpm)

This repo is tracked in mdpm as project `{{project}}`. Log work there so there is an audit trail of what was done and why, but cheaply: every call costs tokens, so touch a task when a unit of work starts and when it ends, not in between. Use the `mdpm` CLI (add `--project {{project}}` if it isn't detected from the repo; writes need the server, so add `--auto-start` if it may be down).

1. **Before starting a unit of work, find or create its task, in one call.** `mdpm task start "<title>" --priority <low|medium|high|urgent> --description "<scope and why>"` resumes the open task with exactly that title or slug, or creates it, and marks it in-progress. To look around first: `mdpm task search "<keywords>"` or `mdpm task list`.
2. **While working, leave the task alone.** No per-step notes or status updates. The one exception is a real stop: `mdpm task set <ref> --status blocked --note "<why>"`.
3. **When the unit is finished, write once:** `mdpm task done <ref> --note "<what was done and why, decisions, how it was verified, commits and PRs>"`, or `mdpm task set <ref> --status in-review --note "..."` if it still needs verification. Several tasks at once (end of a session, /sync, /handoff): one `mdpm task batch` call with JSON on stdin. A note points at commits, PRs and files rather than copying them; put PR and ticket URLs in the note.

Keep it proportionate: one task per unit of work worth reviewing later, not one per typo or formatting tweak. Don't delete tasks to tidy up; archive them (`mdpm task archive <ref>`).
<!-- mdpm:work-logging:end -->
