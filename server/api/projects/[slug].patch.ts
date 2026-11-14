import { withWriter } from '../../utils/writer'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const body = await readBody(event)
  return withWriter(w => w.updateProject(slug, body))
})
