// Project shapes as the API returns them: `GET /api/projects` (Project) and
// `GET /api/projects/[slug]` (ProjectDetail). Shared by the pages and
// components instead of per-file `ProjectHeader`/`ProjectDetail` copies.

export interface Project {
  slug: string
  path: string
  title: string
  status: string
  icon?: string
  description?: string
  tags: string[]
  repo?: string
  createdAt: string
  updatedAt?: string
  archivedAt?: string
}

export interface ProjectDetail extends Project {
  availableStatuses: string[]
  defaultStatus?: string
  defaultPriority?: string
  defaultAssignee?: string
}
