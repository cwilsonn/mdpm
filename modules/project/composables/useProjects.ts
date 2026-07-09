// Project mutation endpoints. Single home for the create/update/delete/reorder
// `$fetch` calls previously inlined in ProjectForm and the projects index page.

/** Writable project fields. All optional so the same shape serves create + patch. */
export interface ProjectPayload {
  title?: string
  status?: string
  icon?: string | null
  description?: string
  tags?: string[]
  githubRepo?: string | null
  availableStatuses?: string[]
  defaultStatus?: string | null
  defaultPriority?: string | null
  defaultAssignee?: string | null
  archivedAt?: string | null
}

export function useProjects() {
  function createProject(body: ProjectPayload) {
    return $fetch('/api/projects', { method: 'POST', body })
  }

  function updateProject(slug: string, body: ProjectPayload) {
    return $fetch(`/api/projects/${slug}`, { method: 'PATCH', body })
  }

  function removeProject(slug: string) {
    return $fetch(`/api/projects/${slug}`, { method: 'DELETE' })
  }

  /** Persist the pinned/unpinned ordering of the projects grid. */
  function reorderProjects(order: { pinned: string[], unpinned: string[] }) {
    return $fetch('/api/projects/reorder', { method: 'POST', body: order })
  }

  function archiveProject(slug: string) {
    return updateProject(slug, { archivedAt: new Date().toISOString() })
  }

  function unarchiveProject(slug: string) {
    return updateProject(slug, { archivedAt: null })
  }

  return { createProject, updateProject, removeProject, reorderProjects, archiveProject, unarchiveProject }
}
