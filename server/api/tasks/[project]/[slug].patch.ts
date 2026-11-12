import { updateTaskFile, type TaskUpdateInput } from '../../../utils/tasks-write'

export default defineEventHandler(async (event) => {
  const project = getRouterParam(event, 'project')!
  const slug = getRouterParam(event, 'slug')!
  const { id, status, notices } = updateTaskFile(project, slug, await readBody<TaskUpdateInput>(event))
  return { ok: true, id, status, ...(notices.length ? { notices } : {}) }
})
