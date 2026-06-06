
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug')!
  assertSafeSlug(slug)
  deleteContent(`projects/${slug}`)
  return { ok: true }
})
