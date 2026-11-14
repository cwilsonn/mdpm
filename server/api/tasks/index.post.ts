import { TaskCreate } from '../../../lib/core/write-schemas'
import { createTaskFile } from '../../utils/tasks-write'

export default defineEventHandler(async (event) => {
  const { slug, id, status } = createTaskFile(await readValidatedBody(event, validator(TaskCreate)))
  return { slug, id, status }
})
