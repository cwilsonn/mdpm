
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug')!
  deleteContent(`projects/${slug}`)
  return { ok: true }
})
