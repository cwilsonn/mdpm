import type { MaybeRefOrGetter } from 'vue'

// `enabled`: false for a create form, which saves through its own button instead.
export function useAutoSave(
  enabled: MaybeRefOrGetter<boolean>,
  saveFn: () => Promise<void>,
) {
  const saving = ref(false)
  const savedAt = ref<Date | null>(null)
  const saveError = ref<string | null>(null)
  // Set when the server refused a save because the record changed elsewhere (409, reason "conflict").
  // Autosave stops until the caller reloads and calls resolveConflict(), so it can't overwrite the newer version.
  const conflict = ref(false)
  const loaded = ref(false)
  const now = ref(Date.now())
  let ticker: ReturnType<typeof setInterval> | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  // A save is scheduled but not sent yet. With `saving`, this is "local edits not yet on disk".
  const queued = ref(false)
  const busy = computed(() => queued.value || saving.value)
  // Set while the caller replaces the fields with the stored version: those changes are not edits.
  let quiet = false

  const savedAgo = computed(() => {
    if (!savedAt.value) return null
    const diff = Math.floor((now.value - savedAt.value.getTime()) / 1000)
    if (diff < 10) return 'just now'
    if (diff < 60) return `${diff}s ago`
    return `${Math.floor(diff / 60)}m ago`
  })

  function scheduleSave() {
    if (quiet) return
    if (!toValue(enabled) || !loaded.value || conflict.value) return
    if (saveTimer) clearTimeout(saveTimer)
    queued.value = true
    saveTimer = setTimeout(() => flushSave(), 800)
  }

  async function flushSave() {
    if (quiet) return
    // An edit made while the previous save is in flight is sent once it lands, not dropped.
    if (saving.value && !conflict.value) { scheduleSave(); return }
    if (!toValue(enabled) || !loaded.value || conflict.value) { queued.value = false; return }
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    queued.value = false
    saving.value = true
    saveError.value = null
    try {
      await saveFn()
      savedAt.value = new Date()
    }
    catch (e: unknown) {
      const body = (e as { data?: { message?: string, data?: { reason?: string } } })?.data
      if (body?.data?.reason === 'conflict') {
        conflict.value = true
        saveError.value = 'Changed elsewhere since you opened it. Reload to get the latest; unsaved edits here will be lost.'
      }
      else saveError.value = body?.message ?? 'Save failed'
    }
    finally {
      saving.value = false
    }
  }

  function initAutoSave() {
    loaded.value = true
    if (toValue(enabled)) {
      ticker = setInterval(() => now.value = Date.now(), 5000)
    }
  }

  /** Run `fn` (which loads the stored version into the fields) without that counting as an edit to save. */
  async function quietly(fn: () => unknown) {
    quiet = true
    try {
      await fn()
      // The field watchers run before the next render; let them see `quiet`.
      await nextTick()
    }
    finally {
      quiet = false
    }
  }

  function resolveConflict() {
    conflict.value = false
    saveError.value = null
  }

  function cleanupAutoSave() {
    if (ticker) clearInterval(ticker)
    if (saveTimer) flushSave()
  }

  return { saving, busy, savedAt, saveError, savedAgo, conflict, scheduleSave, flushSave, quietly, resolveConflict, initAutoSave, cleanupAutoSave }
}
