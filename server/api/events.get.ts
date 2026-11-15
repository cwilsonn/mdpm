// Server-sent events: one `content` event per changed record (see lib/core/live.ts), so open pages
// refresh when the CLI, an agent or another tab writes. A heartbeat keeps proxies from closing an idle stream.
export default defineEventHandler((event) => {
  const stream = createEventStream(event)
  const unsubscribe = subscribeContentEvents((e) => {
    void stream.push({ event: 'content', data: JSON.stringify(e) })
  })
  const heartbeat = setInterval(() => { void stream.push({ event: 'ping', data: '' }) }, 25_000)
  stream.onClosed(async () => {
    clearInterval(heartbeat)
    unsubscribe()
    await stream.close()
  })
  // Tells the client the stream is up, so it can resync whatever it missed while disconnected.
  void stream.push({ event: 'ready', data: '' })
  return stream.send()
})
