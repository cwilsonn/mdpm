export function useMarkDone() {
  const markingDone = ref<string | null>(null)

  async function markDone(
    projectSlug: string,
    taskPath: string,
    onSuccess: () => void | Promise<void>,
  ) {
    const tSlug = slugFromPath(taskPath)
    markingDone.value = taskPath
    try {
      await $fetch(`/api/tasks/${projectSlug}/${tSlug}`, {
        method: 'PATCH',
        body: { status: 'done' },
      })
      await onSuccess()
    }
    catch {}
    finally {
      markingDone.value = null
    }
  }

  return { markingDone, markDone }
}
