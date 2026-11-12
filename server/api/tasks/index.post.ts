import { createTaskFile, type TaskCreateInput } from '../../utils/tasks-write'

export default defineEventHandler(async (event) => {
  const { slug, id, status, notices } = createTaskFile(await readBody<TaskCreateInput>(event))
  return { slug, id, status, ...(notices.length ? { notices } : {}) }
})
