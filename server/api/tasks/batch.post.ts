import { withWriter } from '../../utils/writer'

// Several task writes in one request, applied in order (see Writer.batchTasks).
export default defineEventHandler(async (event) => {
  const body = await readBody<{ ops?: unknown }>(event)
  return withWriter(w => w.batchTasks(body?.ops))
})
