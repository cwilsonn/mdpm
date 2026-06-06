---
title: >-
  Unify nav: list/kanban toggle, remove top-level tasks/docs, redirect / to
  /projects
status: done
priority: high
tags:
  - ui
  - nav
  - refactor
assignees: []
dependencies: []
createdAt: '2026-06-06'
order: 0
updatedAt: '2026-06-06T05:40:57.266Z'
---
## Goal

Centralize UX around projects. Tasks/docs only exist in project context.

## Steps

1. Add list/kanban toggle to `projects/[slug]` — localStorage key `mdpm:task-view`, default `kanban`
2. Move stat bar (cross-project task counts) from dashboard to `/projects` header
3. Delete `/tasks` and `/docs` top-level pages
4. Delete `/` dashboard page, add redirect `/` → `/projects`
5. Remove sidebar links for Tasks/Docs, update back buttons accordingly
