import { existsSync, readdirSync } from 'node:fs'

const STATUS_ORDER = ['todo', 'in-progress', 'in-review', 'blocked', 'done']

const STATUS_LABELS: Record<string, string> = {
  'todo': 'Todo',
  'in-progress': 'In Progress',
  'in-review': 'In Review',
  'blocked': 'Blocked',
  'done': 'Done',
}

export default defineEventHandler((event) => {
  const projectsDir = contentPath('projects')
  if (!existsSync(projectsDir)) {
    throw createError({ statusCode: 404, message: 'No projects found' })
  }

  const projectSlugs = readdirSync(projectsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()

  const lines: string[] = [
    '# mdpm Export',
    '',
    `_Exported: ${new Date().toISOString()}_`,
    '',
    '---',
    '',
  ]

  for (const slug of projectSlugs) {
    const project = readMarkdown(`projects/${slug}/index.md`)
    if (!project) continue

    const { title, status, description, tags } = project.data as Record<string, unknown>

    lines.push(`## ${title ?? slug}`)
    lines.push('')

    const meta: string[] = []
    if (status) meta.push(`**Status:** ${status}`)
    if (Array.isArray(tags) && tags.length) meta.push(`**Tags:** ${(tags as string[]).join(', ')}`)
    if (meta.length) {
      lines.push(meta.join(' · '))
      lines.push('')
    }

    if (description) {
      lines.push(String(description))
      lines.push('')
    }

    const tasksDir = contentPath('projects', slug, 'tasks')
    const taskFiles = existsSync(tasksDir)
      ? readdirSync(tasksDir).filter(f => f.endsWith('.md'))
      : []

    if (taskFiles.length === 0) {
      lines.push('_No tasks._')
      lines.push('')
    } else {
      const tasksByStatus: Record<string, Array<{ title: string; priority: string; due?: string; body: string }>> = {}

      for (const file of taskFiles) {
        const task = readMarkdown(`projects/${slug}/tasks/${file}`)
        if (!task) continue

        const { title: taskTitle, status: taskStatus, priority, due } = task.data as Record<string, unknown>
        const s = (taskStatus as string) ?? 'todo'

        if (!tasksByStatus[s]) tasksByStatus[s] = []
        tasksByStatus[s].push({
          title: (taskTitle as string) ?? file.replace('.md', ''),
          priority: (priority as string) ?? 'medium',
          due: due as string | undefined,
          body: task.content?.trim() ?? '',
        })
      }

      const knownStatuses = STATUS_ORDER.filter(s => tasksByStatus[s]?.length)
      const unknownStatuses = Object.keys(tasksByStatus).filter(s => !STATUS_ORDER.includes(s))
      const presentStatuses = [...knownStatuses, ...unknownStatuses]

      for (const s of presentStatuses) {
        lines.push(`### ${STATUS_LABELS[s] ?? s}`)
        lines.push('')

        for (const task of tasksByStatus[s]!) {
          const checkbox = s === 'done' ? '[x]' : '[ ]'
          const meta: string[] = [`priority: ${task.priority}`]
          if (task.due) meta.push(`due: ${task.due}`)
          lines.push(`- ${checkbox} **${task.title}** — ${meta.join(', ')}`)
          if (task.body) {
            for (const bodyLine of task.body.split('\n')) {
              lines.push(`  ${bodyLine}`)
            }
          }
        }

        lines.push('')
      }
    }

    lines.push('---')
    lines.push('')
  }

  const markdown = lines.join('\n')
  const filename = `mdpm-export-${new Date().toISOString().split('T')[0]}.md`

  setHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="${filename}"`)

  return markdown
})
