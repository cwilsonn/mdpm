---
title: Fix swimlane scrolling and task card min-height
status: done
priority: medium
tags:
  - ui
  - kanban
assignees: []
dependencies: []
createdAt: '2026-06-06'
order: 4
updatedAt: '2026-06-06T04:59:14.412Z'
---
## Problem

Kanban swimlanes need to be scrollable with a max height. `DisplayTaskCard` content is being squished in current layout context.

## Steps

1. Add `min-height: min-content` (or equivalent) to `DisplayTaskCard` so card never squishes its content.
2. Make swimlanes scrollable with a capped max height — each lane scrolls independently.

## Approach

Fix one at a time to isolate which change resolves what.
