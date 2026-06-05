import { readdirSync, existsSync } from 'node:fs'

export default defineEventHandler(() => {
  const dir = contentPath('authors')
  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .flatMap(f => {
      const file = readMarkdown(`authors/${f}`)
      return file ? [{ slug: f.replace('.md', ''), name: file.data.name as string }] : []
    })
    .sort((a, b) => a.name.localeCompare(b.name))
})
