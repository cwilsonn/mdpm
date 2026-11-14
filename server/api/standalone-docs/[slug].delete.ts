import { withWriter } from '../../utils/writer'

export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug')!
  return withWriter(w => w.deleteDoc(null, slug))
})
