import { withWriter } from '../../utils/writer'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ pinned: unknown; unpinned: unknown }>(event)
  return withWriter(w => w.reorderProjects(body?.pinned, body?.unpinned))
})
