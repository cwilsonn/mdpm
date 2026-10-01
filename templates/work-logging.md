<!-- mdpm:work-logging:start -->
## Work logging (mdpm)

This repo is tracked in mdpm as project `{{project}}`. Log work there as you go, so there is an audit trail of what was done and why. Use the `mdpm` CLI (add `--project {{project}}` if it isn't detected from the repo; writes need the server, so add `--auto-start` if it may be down).

1. **Before starting a unit of work, find or create its task.** `mdpm task search "<keywords>"` or `mdpm task list`; if none fits, `mdpm task add "<title>" --priority <low|medium|high|urgent> --description "<scope and why>"`. Mark it started: `mdpm task set <ref> --status in-progress`.
2. **While working, append notes** at meaningful points (decisions and their reasons, surprises, blockers, what you verified): `mdpm task note <ref> "<note>"`.
3. **Reference commits and PRs** in a note, and link PRs with `mdpm task set <ref> --github-prs <n>`.
4. **When finished, set the status:** `in-review` if it still needs verification, otherwise `mdpm task done <ref>`.

Keep it proportionate: one task per unit of work worth reviewing later, not one per typo or formatting tweak. Don't delete tasks to tidy up; archive them (`mdpm task archive <ref>`).
<!-- mdpm:work-logging:end -->
