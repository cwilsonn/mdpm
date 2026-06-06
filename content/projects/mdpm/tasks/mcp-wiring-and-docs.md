---
title: 'MCP wiring: registration + CLAUDE.md'
status: done
priority: medium
tags:
  - mcp
assignees: []
dependencies:
  - mcp-server
  - claude-code-skills
createdAt: '2026-06-05'
updatedAt: '2026-06-05T00:00:00Z'
order: 10
---
Register mdpm MCP server globally in `~/.claude.json` via `claude mcp add --scope user`. Install `@modelcontextprotocol/sdk` and `tsx` devDependencies. Smoke tested — ping returns 3 projects.
