
export default defineEventHandler((event) => {
  const project = getRouterParam(event, 'project')!
  const slug = getRouterParam(event, 'slug')!
  assertSafeSlug(project, slug)
  deleteContent(`projects/${project}/tasks/${slug}.md`)
  return { ok: true }
})
