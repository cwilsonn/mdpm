// Shortcut for the common "mark this task done" action. Delegates the status
// PATCH to useTasks().updateTask (one home for that endpoint) and toasts on
// failure instead of swallowing silently.
export function useMarkDone() {
  const { updateTask } = useTasks()
  const { tryWithToast } = useApiToast()

  const markingDone = ref<string | null>(null)

  async function markDone(
    projectSlug: string,
    taskPath: string,
    onSuccess: () => void | Promise<void>,
  ) {
    const tSlug = slugFromPath(taskPath)
    markingDone.value = taskPath
    try {
      const ok = await tryWithToast(
        () => updateTask(projectSlug, tSlug, { status: 'done' }),
        'Failed to mark task done',
      )
      if (ok) await onSuccess()
    }
    finally {
      markingDone.value = null
    }
  }

  return { markingDone, markDone }
}
