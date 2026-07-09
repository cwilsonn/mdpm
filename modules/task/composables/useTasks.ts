// Task mutation endpoints. Single home for the create/update/delete `$fetch`
// calls that were inlined across TaskForm, the tasks page, and the task detail
// page. Reads still use useAsyncData; drag-reorder lives in useReorder and the
// done shortcut in useMarkDone.

/** Writable task fields. All optional so the same shape serves create + patch. */
export interface TaskPayload {
  project?: string
  title?: string
  status?: string
  priority?: string
  tags?: string[]
  assignees?: string[]
  due?: string
  dependencies?: string[]
  githubIssues?: number[]
  githubPRs?: number[]
  description?: string
  archivedAt?: string | null
}

export function useTasks() {
  function createTask(body: TaskPayload) {
    return $fetch('/api/tasks', { method: 'POST', body })
  }

  function updateTask(project: string, slug: string, body: TaskPayload) {
    return $fetch(`/api/tasks/${project}/${slug}`, { method: 'PATCH', body })
  }

  function removeTask(project: string, slug: string) {
    return $fetch(`/api/tasks/${project}/${slug}`, { method: 'DELETE' })
  }

  function archiveTask(project: string, slug: string) {
    return updateTask(project, slug, { archivedAt: new Date().toISOString() })
  }

  function unarchiveTask(project: string, slug: string) {
    return updateTask(project, slug, { archivedAt: null })
  }

  return { createTask, updateTask, removeTask, archiveTask, unarchiveTask }
}
