// Keeps open pages current when content changes on disk (the CLI, an agent, another tab).
// Every change refreshes the page's data (debounced, so a burst like a reorder is one refresh);
// open editors also get the event through useLive().onContent and decide for themselves.
// The stream is closed while the tab is hidden and reopened with a full resync when it is shown,
// so background tabs don't hold connections (browsers allow ~6 per host over HTTP/1.1).
export default defineNuxtPlugin(() => {
  if (typeof EventSource === 'undefined') return

  let source: EventSource | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let missed = false
  let connectedOnce = false

  function refreshSoon() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (liveHeld()) { missed = true; return }
      void refreshNuxtData()
    }, 200)
  }

  setLiveReleaseHandler(() => {
    if (missed) { missed = false; refreshSoon() }
  })

  function open() {
    if (source) return
    source = new EventSource('/api/events')
    source.addEventListener('content', (msg) => {
      let e
      try { e = JSON.parse((msg as MessageEvent<string>).data) }
      catch { return }
      emitLive(e)
      refreshSoon()
    })
    // Sent on every (re)connect, including EventSource's own retries after a dropped connection.
    source.addEventListener('ready', () => {
      if (connectedOnce) {
        emitLive({ kind: 'resync' })
        refreshSoon()
      }
      connectedOnce = true
    })
  }

  function close() {
    source?.close()
    source = null
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') close()
    else open()
  })
  if (document.visibilityState !== 'hidden') open()
})
