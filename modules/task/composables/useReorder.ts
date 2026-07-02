// Drag-reorder for single-project task boards (kanban + the project tasks page).
// Owns the shared orchestration those two used to copy-paste — optimistic status
// set, status PATCH, manual-order persist, error toast, refresh — so callers just
// supply their project/columns/refresh. The status PATCH delegates to
// useTasks().updateTask (one home for that endpoint); this composable owns only
// the reorder POST.
//
// InboxTaskList is intentionally NOT a consumer: it's multi-project/per-group and
// gates persistence on manual sort, so it keeps its own wiring and reuses just
// persistOrder from here.
export function useReorder() {
  const { updateTask } = useTasks()
  const { withErrorToast } = useApiToast()

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

  interface ColumnDragOptions {
    /** Called after the mutation settles (success or failure) to resync state. */
    onRefresh: () => void | Promise<void>
    /**
     * Whether to persist manual order. Pass `false` when a filter/search is
     * active — `columns` then holds only the visible subset, and rewriting order
     * from it would collide with hidden tasks' stale order values. The status
     * move still persists; only the manual ordering is skipped.
     */
    persist?: boolean
  }

  /** Handle a card dragged INTO a column (status change + optional reorder). */
  async function handleColumnAdd(
    project: string,
    columns: Record<string, Task[]>,
    colId: string,
    evt: { newIndex?: number },
    { onRefresh, persist = true }: ColumnDragOptions,
  ) {
    const task = columns[colId]?.[evt.newIndex ?? 0]
    if (!task) return
    const tSlug = slugFromPath(task.path)
    task.status = colId
    updating.value = task.path
    try {
      await withErrorToast(async () => {
        await updateTask(project, tSlug, { status: colId })
        if (persist) await persistOrder(project, columns)
      }, 'Failed to move task')
    }
    catch {}
    finally {
      await onRefresh()
      updating.value = null
    }
  }

  /** Handle a reorder WITHIN a column (manual order only). */
  async function handleColumnUpdate(
    project: string,
    columns: Record<string, Task[]>,
    { onRefresh, persist = true }: ColumnDragOptions,
  ) {
    try {
      if (persist) {
        await withErrorToast(() => persistOrder(project, columns), 'Failed to save order')
      }
    }
    catch {}
    finally {
      await onRefresh()
    }
  }

  return { updating, persistOrder, handleColumnAdd, handleColumnUpdate }
}
