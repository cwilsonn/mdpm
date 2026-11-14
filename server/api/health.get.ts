// Liveness plus where this server reads and writes content. The CLI compares that path with its own
// before writing, so a server started against a different content root can't silently split data.
// Only the public demo omits it.
export default defineEventHandler(() => ({
  ok: true,
  ...(!isDemo() && { contentRoot: contentRoot() }),
}))
