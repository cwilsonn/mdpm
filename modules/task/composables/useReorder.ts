// Shared drag-reorder persistence for task boards/lists. Extracts the two
// primitives that were hand-rolled (with identical `$fetch` URLs and the same
// order-building loop) across AppTaskKanban, the project tasks page, and
// InboxTaskList: writing a project's manual order, and moving a task to a new
// status when dragged across columns.
export function useReorder() {
  // Path of the task currently being persisted (drive per-card loading state).
  const updating = ref<string | null>(null)

  /**
   * POST the manual ordering for a single project.
   * `columns` maps statusId -> tasks in their displayed order.
   */
  async function persistOrder(project: string, columns: Record<string, Task[]>) {
    const order: Record<string, string[]> = {}
    for (const [statusId, tasks] of Object.entries(columns)) {
      order[statusId] = (tasks ?? []).map(t => slugFromPath(t.path))
    }
    await $fetch('/api/tasks/reorder', {
      method: 'POST',
      body: { project, order },
    })
  }

  /** PATCH a task's status (used when a card is dragged into another column). */
  async function moveTask(project: string, taskSlug: string, status: string) {
    await $fetch(`/api/tasks/${project}/${taskSlug}`, {
      method: 'PATCH',
      body: { status },
    })
  }

  return { updating, persistOrder, moveTask }
}
