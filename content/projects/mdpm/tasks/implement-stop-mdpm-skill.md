---
title: Implement /stop-mdpm skill
status: done
priority: low
tags:
  - skills
  - dx
assignees: []
dependencies: []
createdAt: '2026-06-06'
order: 6
updatedAt: '2026-06-06T01:40:46.427Z'
---
Add a `/stop-mdpm` global skill that kills the running mdpm dev server.

## Plan

1. Create `~/.claude/commands/stop-mdpm.md` skill file.
2. Logic:
  - Fetch `http://mdpm.local:3333` — if ECONNREFUSED, output "mdpm is not running" and stop.
  - Find the PID: `lsof -ti tcp:3333` or read the Nuxt lock file at `/tmp/nuxt-mdpm.local-3333.lock` (contains PID).
  - Kill the process: `kill <PID>`.
  - Poll for up to 5s to confirm port is free.
  - Output: `✓ mdpm stopped` or `⚠️ mdpm did not stop in time`.
3. Mirror the structure/style of `/start-mdpm` for consistency.
