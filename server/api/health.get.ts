// Liveness plus, outside production, where this server reads and writes content. The CLI compares
// that path with its own before writing, so a server started against a different content root
// can't silently split data. Production omits the path: the demo instance is public.
export default defineEventHandler(() => ({
  ok: true,
  ...(process.env.NODE_ENV !== 'production' && { contentRoot: contentRoot() }),
}))
