import { withWriter } from '../../../utils/writer'

export default defineEventHandler((event) => {
  const project = getRouterParam(event, 'project')!
  const slug = getRouterParam(event, 'slug')!
  return withWriter(w => w.deleteDoc(project, slug))
})
