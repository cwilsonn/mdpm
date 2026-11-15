// Live updates from the server's content watcher (GET /api/events, see lib/core/live.ts).
// One EventSource per tab, opened by plugins/live.client.ts; this module holds the shared state.
// `resync` is delivered after a (re)connect: events may have been missed, so check again.
import type { ContentEvent } from '../../../lib/core/live'

export type LiveEvent = ContentEvent | { kind: 'resync' }
type Listener = (e: LiveEvent) => void

const listeners = new Set<Listener>()
let holds = 0
let onRelease: (() => void) | null = null

export function emitLive(e: LiveEvent) {
  for (const fn of listeners) fn(e)
}

/** While held (a drag in progress), page data is not refreshed; one refresh follows the release if anything changed. */
export function liveHeld() { return holds > 0 }
export function setLiveReleaseHandler(fn: () => void) { onRelease = fn }

export function useLive() {
  /** Listen for the component's lifetime. */
  function onContent(fn: Listener) {
    if (import.meta.server) return
    listeners.add(fn)
    onBeforeUnmount(() => listeners.delete(fn))
  }

  function hold() {
    holds++
    let released = false
    return () => {
      if (released) return
      released = true
      holds--
      if (!holds) onRelease?.()
    }
  }

  return { onContent, hold }
}

/** Two updatedAt values naming the same instant (the reader can shorten a midnight date). */
export function sameInstant(a: string | null | undefined, b: string | null | undefined) {
  if ((a ?? null) === (b ?? null)) return true
  if (!a || !b) return false
  const ta = Date.parse(a)
  return !Number.isNaN(ta) && ta === Date.parse(b)
}

/**
 * For an open editor: notice when its record changes on disk (not through this editor) and either load the
 * new version right away (`silent()` true: idle and not focused) or set `changed` so the editor can offer it.
 * Its own saves come back as events too; they carry the updatedAt the save answered with and are ignored.
 * While a save is pending or in flight the check waits for it, since the echo can beat the PATCH response.
 * The server's 409 stays the backstop: an edit sent against an old base is refused, never merged.
 */
export function useRemoteRecord<T extends { updatedAt?: string | null }>(opts: {
  match: (e: ContentEvent) => boolean
  base: Ref<string | null | undefined>
  /** Local edits pending or being saved. */
  busy: Ref<boolean>
  /** Not checking at all (not loaded yet, or already in a 409 conflict). */
  blocked: Ref<boolean>
  fetchLatest: () => Promise<T>
  apply: (latest: T) => unknown
  silent: () => boolean
}) {
  const changed = ref(false)
  const loading = ref(false)
  let deferred = false

  async function check() {
    if (opts.blocked.value || changed.value) return
    if (opts.busy.value) { deferred = true; return }
    let latest: T
    try { latest = await opts.fetchLatest() }
    catch { return }
    if (opts.blocked.value) return
    if (opts.busy.value) { deferred = true; return }
    if (sameInstant(latest.updatedAt, opts.base.value)) return
    if (opts.silent()) await opts.apply(latest)
    else changed.value = true
  }

  watch(opts.busy, (b) => {
    if (!b && deferred) { deferred = false; void check() }
  })

  useLive().onContent((e) => {
    if (e.kind !== 'resync') {
      if (!opts.match(e) || e.op === 'delete') return
      if (e.updatedAt !== undefined && sameInstant(e.updatedAt, opts.base.value)) return
    }
    void check()
  })

  /** Load the stored version (dropping any local edits), e.g. from the "changed elsewhere" prompt. */
  async function loadLatest() {
    loading.value = true
    try {
      await opts.apply(await opts.fetchLatest())
      changed.value = false
    }
    finally {
      loading.value = false
    }
  }

  function dismiss() { changed.value = false }

  return { changed, loading, loadLatest, dismiss }
}
