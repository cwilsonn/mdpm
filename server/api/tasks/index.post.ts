import { withWriter } from '../../utils/writer'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  return withWriter(w => w.createTask(body))
})
