import { withWriter } from '../../../utils/writer'

export default defineEventHandler(async (event) => {
  const project = getRouterParam(event, 'project')!
  const slug = getRouterParam(event, 'slug')!
  const body = await readBody(event)
  return withWriter(w => w.updateTask(project, slug, body))
})
