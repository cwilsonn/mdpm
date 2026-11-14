import type { DocCreateInput } from '../../../lib/core/write'
import { withWriter } from '../../utils/writer'

export default defineEventHandler(async (event) => {
  const body = await readBody<DocCreateInput>(event)
  return withWriter(w => w.createDoc(null, body))
})
