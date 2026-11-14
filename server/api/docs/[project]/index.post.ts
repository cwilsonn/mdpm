import type { DocCreateInput } from '../../../../lib/core/write'
import { withWriter } from '../../../utils/writer'

export default defineEventHandler(async (event) => {
  const project = getRouterParam(event, 'project')!
  const body = await readBody<DocCreateInput>(event)
  return withWriter(w => w.createDoc(project, body))
})
