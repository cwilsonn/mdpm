import type { Ops } from './ops'

// Export tasks and docs to JSON (full fidelity), CSV (tasks, for spreadsheets), or markdown
// (human-readable). Everything is read from the files, so no server is needed. There is no importer:
// export is the way data leaves mdpm (backups, other tools).
//
// Format version 3: links live in task and doc bodies (no `links` field); a project carries its `repo` URL.

export const EXPORT_FORMAT = 'mdpm-export'
export const EXPORT_FORMAT_VERSION = 3

export interface ExportedTask {
  slug: string
  title: string
  status: string
  priority: string
  tags: string[]
  assignees: string[]
  due: string | null
  dependencies: string[]
  createdAt: string
  updatedAt: string | null
  archivedAt: string | null
  description: string
}

export interface ExportedDoc {
  slug: string
  title: string
  tags: string[]
  parent: string | null
  createdAt: string
  updatedAt: string | null
  archivedAt: string | null
  body: string
}

export interface ExportedProject {
  slug: string
  title: string
  status: string
  icon: string | null
  description: string | null
  tags: string[]
  repo: string | null
  createdAt: string
  archivedAt: string | null
  tasks: ExportedTask[]
  docs: ExportedDoc[]
}

export interface ExportDocument {
  format: typeof EXPORT_FORMAT
  formatVersion: number
  exportedAt: string
  projects: ExportedProject[]
  standaloneDocs: ExportedDoc[]
}

export interface ExportOptions {
  /** Export just this project; omit for every project (and standalone docs). */
  project?: string
  includeArchived?: boolean
  docs?: boolean
}

const asDoc = (d: { slug: string; title: string; tags: string[]; parent: string | null; createdAt: string; updatedAt: string | null; archivedAt: string | null; body: string }): ExportedDoc => ({
  slug: d.slug, title: d.title, tags: d.tags, parent: d.parent, createdAt: d.createdAt, updatedAt: d.updatedAt, archivedAt: d.archivedAt, body: d.body,
})

export function buildExport(ops: Ops, opts: ExportOptions = {}, now = new Date()): ExportDocument {
  const withDocs = opts.docs !== false
  const projects = ops.listProjects({ includeArchived: opts.includeArchived })
    .filter(p => !opts.project || p.slug === opts.project)
    .map((p): ExportedProject => ({
      slug: p.slug,
      title: p.title,
      status: p.status,
      icon: p.icon,
      description: p.description,
      tags: p.tags,
      repo: p.repo,
      createdAt: p.createdAt,
      archivedAt: p.archivedAt,
      tasks: ops.listTasks({ project: p.slug, includeArchived: opts.includeArchived }).map(t => ({
        slug: t.slug, title: t.title, status: t.status, priority: t.priority, tags: t.tags, assignees: t.assignees, due: t.due,
        dependencies: t.dependencies,
        createdAt: t.createdAt, updatedAt: t.updatedAt, archivedAt: t.archivedAt, description: t.body,
      })),
      docs: withDocs ? ops.listDocsWithBody({ project: p.slug, includeArchived: opts.includeArchived }).map(asDoc) : [],
    }))
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    projects,
    standaloneDocs: withDocs && !opts.project ? ops.listDocsWithBody({ standalone: true, includeArchived: opts.includeArchived }).map(asDoc) : [],
  }
}

// ── CSV ───────────────────────────────────────────────────────────────────────

export const CSV_COLUMNS = ['project', 'slug', 'title', 'status', 'priority', 'tags', 'assignees', 'due', 'dependencies', 'created_at', 'updated_at', 'archived_at', 'description'] as const

// RFC 4180 quoting: wrap in quotes when the value has a comma, quote, or line break; double inner quotes.
const cell = (value: unknown) => {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Lists use `;` inside a cell (tags can contain commas' worth of structure, and `;` survives spreadsheets).
export function toCsv(doc: ExportDocument): string {
  const rows = doc.projects.flatMap(p => p.tasks.map(t => [
    p.slug, t.slug, t.title, t.status, t.priority, t.tags.join(';'), t.assignees.join(';'), t.due, t.dependencies.join(';'),
    t.createdAt, t.updatedAt, t.archivedAt, t.description,
  ]))
  return `${[CSV_COLUMNS as readonly string[], ...rows].map(r => r.map(cell).join(',')).join('\n')}\n`
}

// ── Markdown ──────────────────────────────────────────────────────────────────

const STATUS_ORDER = ['in-progress', 'blocked', 'in-review', 'todo', 'on-hold', 'done']
const STATUS_LABEL: Record<string, string> = { 'in-progress': 'In progress', 'blocked': 'Blocked', 'in-review': 'In review', 'todo': 'Todo', 'on-hold': 'On hold', 'done': 'Done' }

export function toMarkdown(doc: ExportDocument): string {
  const out = ['# mdpm export', '', `_Exported ${doc.exportedAt}_`]
  for (const p of doc.projects) {
    out.push('', `## ${p.title} (\`${p.slug}\`)`, '')
    out.push([`status: ${p.status}${p.archivedAt ? ' (archived)' : ''}`, p.tags.length && `tags: ${p.tags.join(', ')}`, p.repo && `repo: ${p.repo}`].filter(Boolean).join(' · '))
    if (p.description) out.push('', `> ${p.description.replace(/\n/g, '\n> ')}`)
    if (p.tasks.length) {
      out.push('', '### Tasks')
      const statuses = [...STATUS_ORDER, ...new Set(p.tasks.map(t => t.status).filter(s => !STATUS_ORDER.includes(s)))]
      for (const status of statuses) {
        const tasks = p.tasks.filter(t => t.status === status)
        if (!tasks.length) continue
        out.push('', `#### ${STATUS_LABEL[status] ?? status} (${tasks.length})`, '')
        for (const t of tasks) {
          const meta = [t.priority, t.tags.length && t.tags.join(', '), t.assignees.length && `@${t.assignees.join(' @')}`, t.due && `due ${t.due}`, t.archivedAt && 'archived'].filter(Boolean).join(' · ')
          out.push(`- [${status === 'done' ? 'x' : ' '}] **${t.title}** \`${t.slug}\`${meta ? ` (${meta})` : ''}`)
          if (t.dependencies.length) out.push(`  - waits on: ${t.dependencies.map(d => `\`${d}\``).join(', ')}`)
          if (t.description.trim()) out.push(...t.description.trim().split('\n').map(l => l ? `  > ${l}` : '  >'))
        }
      }
    }
    if (p.docs.length) {
      out.push('', '### Docs', '', ...p.docs.map(d => `- **${d.title}** \`${d.slug}\`${d.tags.length ? ` (${d.tags.join(', ')})` : ''}${d.archivedAt ? ' (archived)' : ''}`))
    }
  }
  if (doc.standaloneDocs.length) {
    out.push('', '## Standalone docs', '', ...doc.standaloneDocs.map(d => `- **${d.title}** \`${d.slug}\`${d.tags.length ? ` (${d.tags.join(', ')})` : ''}`))
  }
  return `${out.join('\n')}\n`
}
