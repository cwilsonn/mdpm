import { createContentWatcher, type ContentEvent, type ContentWatcher } from '../../lib/core/live'

// One content watcher per server process, shared by every open /api/events stream. It starts with the
// first subscriber and stops with the last, so a server nobody is looking at watches nothing.
// Kept on globalThis so a dev-server reload of this module doesn't start a second watcher.
interface Hub { watcher: ContentWatcher | null, root: string | null, subscribers: Set<(e: ContentEvent) => void> }
const g = globalThis as { __mdpmLiveHub?: Hub }
const hub: Hub = g.__mdpmLiveHub ??= { watcher: null, root: null, subscribers: new Set() }

export function subscribeContentEvents(fn: (e: ContentEvent) => void): () => void {
  hub.subscribers.add(fn)
  if (!hub.watcher) {
    hub.root = contentRoot()
    hub.watcher = createContentWatcher(hub.root, (e) => {
      for (const sub of hub.subscribers) sub(e)
    }, { onError: err => console.warn(`[mdpm] live updates off: cannot watch ${hub.root}: ${err.message}`) })
  }
  return () => {
    hub.subscribers.delete(fn)
    if (!hub.subscribers.size) stopContentWatcher()
  }
}

export function stopContentWatcher() {
  hub.watcher?.close()
  hub.watcher = null
}
