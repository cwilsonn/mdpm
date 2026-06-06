---
title: 'MCP server: local stdio'
status: done
priority: high
tags:
  - mcp
assignees: []
dependencies: []
createdAt: '2026-06-05'
updatedAt: '2026-06-06T04:59:18.198Z'
order: 1
---
`mcp/index.ts` — stdio server with 11 tools: ping, list/get projects, list/get/create/update tasks, list/get/search/upsert docs. Reads files directly via gray-matter, writes via HTTP API.
