import type { ComputedRef, Ref } from 'vue'

export function useAutoSave(
  isEdit: Ref<boolean> | ComputedRef<boolean>,
  saveFn: () => Promise<void>,
) {
  const saving = ref(false)
  const savedAt = ref<Date | null>(null)
  const saveError = ref<string | null>(null)
  const loaded = ref(false)
  const now = ref(Date.now())
  let ticker: ReturnType<typeof setInterval> | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const savedAgo = computed(() => {
    if (!savedAt.value) return null
    const diff = Math.floor((now.value - savedAt.value.getTime()) / 1000)
    if (diff < 10) return 'just now'
    if (diff < 60) return `${diff}s ago`
    return `${Math.floor(diff / 60)}m ago`
  })

  function scheduleSave() {
    if (!isEdit.value || !loaded.value) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => flushSave(), 800)
  }

  async function flushSave() {
    if (!isEdit.value || !loaded.value || saving.value) return
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    saving.value = true
    saveError.value = null
    try {
      await saveFn()
      savedAt.value = new Date()
    }
    catch (e: unknown) {
      saveError.value = (e as { data?: { message?: string } })?.data?.message ?? 'Save failed'
    }
    finally {
      saving.value = false
    }
  }

  function initAutoSave() {
    loaded.value = true
    if (isEdit.value) {
      ticker = setInterval(() => now.value = Date.now(), 5000)
    }
  }

  function cleanupAutoSave() {
    if (ticker) clearInterval(ticker)
    if (saveTimer) flushSave()
  }

  return { saving, savedAt, saveError, savedAgo, scheduleSave, flushSave, initAutoSave, cleanupAutoSave }
}
