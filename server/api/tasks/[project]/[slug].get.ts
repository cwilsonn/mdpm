export default defineEventHandler(async (event) => {
  const project = getRouterParam(event, 'project')!
  const slug = getRouterParam(event, 'slug')!

  const file = readMarkdown(`projects/${project}/tasks/${slug}.md`)
  if (!file) throw createError({ statusCode: 404, message: 'Task not found' })

  return { frontmatter: file.data, body: file.content }
})
