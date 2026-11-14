import { withWriter } from '../../utils/writer'

export default defineEventHandler(async (event) => {
  const { project, order } = await readBody<{ project: string; order: Record<string, string[]> }>(event)
  if (!project) throw createError({ statusCode: 400, message: 'project required' })
  if (!order || typeof order !== 'object') throw createError({ statusCode: 400, message: 'order must map statuses to slug arrays' })
  return withWriter(w => w.reorderTasks(project, order))
})
