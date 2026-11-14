import { TaskUpdate } from '../../../../lib/core/write-schemas'
import { updateTaskFile } from '../../../utils/tasks-write'

export default defineEventHandler(async (event) => {
  const project = getRouterParam(event, 'project')!
  const slug = getRouterParam(event, 'slug')!
  const { id, status, notices } = updateTaskFile(project, slug, await readValidatedBody(event, validator(TaskUpdate)))
  return { ok: true, id, status, ...(notices.length ? { notices } : {}) }
})
