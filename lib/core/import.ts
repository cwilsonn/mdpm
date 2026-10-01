import { EXPORT_FORMAT } from './export'
import type { Ops } from './ops'
import { TASK_PRIORITIES, TASK_STATUSES } from './schema'

// Import tasks and docs from an mdpm JSON export, a JSON array of tasks, or a CSV of tasks. The file is
// validated in full before anything is written, so a bad row never leaves a half-imported project behind.

export class ImportError extends Error {
  override name = 'ImportError'
  constructor(message: string, readonly problems: string[] = []) {
    super(problems.length ? `${message}:\n${problems.slice(0, 10).map(p => `  - ${p}`).join('\n')}${problems.length > 10 ? `\n  … and ${problems.length - 10} more` : ''}` : message)
  }
}

export interface ImportTask {
  slug?: string
  title: string
  status?: string
  priority?: string
  tags?: string[]
  assignees?: string[]
  due?: string | null
  dependencies?: string[]
  githubIssues?: number[]
  githubPRs?: number[]
  archivedAt?: string | null
  description?: string
}

export interface ImportDoc {
  slug?: string
  title: string
  tags?: string[]
  parent?: string | null
  archivedAt?: string | null
  body?: string
}

export interface ImportProject {
  slug: string
  title?: string
  status?: string
  icon?: string | null
  description?: string | null
  tags?: string[]
  githubRepo?: string | null
  tasks: ImportTask[]
  docs: ImportDoc[]
}

export interface ImportData {
  projects: ImportProject[]
  standaloneDocs: ImportDoc[]
}

// ── CSV ───────────────────────────────────────────────────────────────────────

// Minimal RFC 4180 reader: quoted fields, doubled quotes, line breaks inside quotes, CRLF or LF, a BOM.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      }
      else field += c
    }
    else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    }
    else field += c
  }
  if (quoted) throw new ImportError('the CSV ends inside a quoted field')
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim() !== ''))
}

const HEADER_ALIASES: Record<string, string> = {
  github_issues: 'githubIssues', githubissues: 'githubIssues', issues: 'githubIssues',
  github_prs: 'githubPRs', githubprs: 'githubPRs', prs: 'githubPRs',
  created_at: 'createdAt', updated_at: 'updatedAt', archived_at: 'archivedAt', body: 'description',
}

// ── Normalization ─────────────────────────────────────────────────────────────

const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(v => String(v).trim()).filter(Boolean)
    : typeof value === 'string' ? value.split(/[;,]/).map(v => v.trim()).filter(Boolean)
      : []

const numbers = (value: unknown, where: string, problems: string[]): number[] =>
  (Array.isArray(value) ? value.map(String) : list(value)).flatMap((s) => {
    const n = Number(s)
    if (!Number.isInteger(n) || n < 1) { problems.push(`${where}: '${s}' is not a positive integer`); return [] }
    return [n]
  })

function normalizeTask(raw: Record<string, unknown>, where: string, problems: string[]): ImportTask | undefined {
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (!title) { problems.push(`${where}: missing title`); return undefined }
  const at = `${where} '${title}'`
  const status = raw.status === undefined || raw.status === '' ? undefined : String(raw.status)
  const priority = raw.priority === undefined || raw.priority === '' ? undefined : String(raw.priority)
  if (status && !(TASK_STATUSES as readonly string[]).includes(status)) problems.push(`${at}: status '${status}' is not one of ${TASK_STATUSES.join(', ')}`)
  if (priority && !(TASK_PRIORITIES as readonly string[]).includes(priority)) problems.push(`${at}: priority '${priority}' is not one of ${TASK_PRIORITIES.join(', ')}`)
  const due = raw.due === undefined || raw.due === null || raw.due === '' ? null : String(raw.due)
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) problems.push(`${at}: due '${due}' is not YYYY-MM-DD`)
  return {
    slug: typeof raw.slug === 'string' && raw.slug.trim() ? raw.slug.trim() : undefined,
    title,
    status,
    priority,
    tags: list(raw.tags),
    assignees: list(raw.assignees),
    due,
    dependencies: list(raw.dependencies),
    githubIssues: numbers(raw.githubIssues, `${at} githubIssues`, problems),
    githubPRs: numbers(raw.githubPRs, `${at} githubPRs`, problems),
    archivedAt: raw.archivedAt ? String(raw.archivedAt) : null,
    description: typeof raw.description === 'string' ? raw.description : '',
  }
}

function normalizeDoc(raw: Record<string, unknown>, where: string, problems: string[]): ImportDoc | undefined {
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (!title) { problems.push(`${where}: missing title`); return undefined }
  return {
    slug: typeof raw.slug === 'string' && raw.slug.trim() ? raw.slug.trim() : undefined,
    title,
    tags: list(raw.tags),
    parent: typeof raw.parent === 'string' && raw.parent ? raw.parent : null,
    archivedAt: raw.archivedAt ? String(raw.archivedAt) : null,
    body: typeof raw.body === 'string' ? raw.body : '',
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export type ImportFormat = 'json' | 'csv'

export function detectFormat(text: string, hint?: string): ImportFormat {
  if (hint === 'json' || hint === 'csv') return hint
  return /^\s*[[{]/.test(text.replace(/^﻿/, '')) ? 'json' : 'csv'
}

export function parseImport(text: string, opts: { format?: string; project?: string } = {}): ImportData {
  const problems: string[] = []
  const projects = new Map<string, ImportProject>()
  const project = (slug: string) => {
    if (!projects.has(slug)) projects.set(slug, { slug, tasks: [], docs: [] })
    return projects.get(slug)!
  }
  const taskInto = (raw: Record<string, unknown>, where: string) => {
    const slug = (typeof raw.project === 'string' && raw.project.trim()) || opts.project
    if (!slug) { problems.push(`${where}: no project (add a project column/field, or pass --project)`); return }
    const task = normalizeTask(raw, where, problems)
    if (task) project(slug).tasks.push(task)
  }
  let standaloneDocs: ImportDoc[] = []

  if (detectFormat(text, opts.format) === 'csv') {
    const [header, ...rows] = parseCsv(text)
    if (!header) throw new ImportError('the CSV is empty')
    const keys = header.map((h) => { const k = h.trim().toLowerCase(); return HEADER_ALIASES[k] ?? k })
    if (!keys.includes('title')) throw new ImportError(`the CSV needs a title column (found: ${header.join(', ')})`)
    rows.forEach((cells, i) => taskInto(Object.fromEntries(keys.map((k, j) => [k, cells[j] ?? ''])), `row ${i + 2}`))
  }
  else {
    let parsed: unknown
    try { parsed = JSON.parse(text.replace(/^﻿/, '')) }
    catch (err) { throw new ImportError(`the file is not valid JSON: ${(err as Error).message}`) }

    if (Array.isArray(parsed)) {
      parsed.forEach((raw, i) => isObject(raw) ? taskInto(raw, `task #${i + 1}`) : problems.push(`task #${i + 1}: expected an object`))
    }
    else if (isObject(parsed) && Array.isArray(parsed.projects)) {
      if (parsed.format !== undefined && parsed.format !== EXPORT_FORMAT) throw new ImportError(`unrecognised export format '${String(parsed.format)}' (expected '${EXPORT_FORMAT}')`)
      for (const [pi, rawProject] of (parsed.projects as unknown[]).entries()) {
        if (!isObject(rawProject) || typeof rawProject.slug !== 'string' || !rawProject.slug) { problems.push(`project #${pi + 1}: missing slug`); continue }
        const p = project(rawProject.slug)
        Object.assign(p, {
          title: typeof rawProject.title === 'string' ? rawProject.title : undefined,
          status: typeof rawProject.status === 'string' ? rawProject.status : undefined,
          icon: typeof rawProject.icon === 'string' ? rawProject.icon : null,
          description: typeof rawProject.description === 'string' ? rawProject.description : null,
          tags: list(rawProject.tags),
          githubRepo: typeof rawProject.githubRepo === 'string' ? rawProject.githubRepo : null,
        })
        for (const [i, t] of (Array.isArray(rawProject.tasks) ? rawProject.tasks : []).entries()) {
          const task = isObject(t) ? normalizeTask(t, `${p.slug} task #${i + 1}`, problems) : (problems.push(`${p.slug} task #${i + 1}: expected an object`), undefined)
          if (task) p.tasks.push(task)
        }
        for (const [i, d] of (Array.isArray(rawProject.docs) ? rawProject.docs : []).entries()) {
          const doc = isObject(d) ? normalizeDoc(d, `${p.slug} doc #${i + 1}`, problems) : undefined
          if (doc) p.docs.push(doc)
        }
      }
      standaloneDocs = (Array.isArray(parsed.standaloneDocs) ? parsed.standaloneDocs : []).flatMap((d, i) => {
        const doc = isObject(d) ? normalizeDoc(d, `standalone doc #${i + 1}`, problems) : undefined
        return doc ? [doc] : []
      })
    }
    else if (isObject(parsed) && Array.isArray(parsed.tasks)) {
      const slug = (typeof parsed.project === 'string' && parsed.project) || opts.project
      if (!slug) problems.push('no project: the object has no "project" field and --project was not given')
      else (parsed.tasks as unknown[]).forEach((raw, i) => isObject(raw) ? taskInto({ ...raw, project: slug }, `task #${i + 1}`) : problems.push(`task #${i + 1}: expected an object`))
    }
    else throw new ImportError('unrecognised JSON: expected an mdpm export, an object with "tasks", or an array of tasks')
  }
  if (problems.length) throw new ImportError(`cannot import: ${problems.length} problem${problems.length === 1 ? '' : 's'} in the file; nothing was written`, problems)
  return { projects: [...projects.values()], standaloneDocs }
}

// ── Running an import ─────────────────────────────────────────────────────────

export type OnExists = 'skip' | 'update' | 'duplicate'

export interface ImportOptions {
  createProjects?: boolean
  onExists?: OnExists
  docs?: boolean
  dryRun?: boolean
}

export interface ImportStep {
  kind: 'project' | 'task' | 'doc'
  action: 'create' | 'update' | 'skip' | 'exists' | 'failed'
  project?: string
  key: string
  slug?: string
  error?: string
}

// What the server would call a title. Only used to label dry runs; real slugs come from the server.
const predictSlug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export async function runImport(ops: Ops, data: ImportData, opts: ImportOptions = {}): Promise<ImportStep[]> {
  const onExists = opts.onExists ?? 'skip'
  const dry = !!opts.dryRun
  const steps: ImportStep[] = []
  const known = new Map(ops.listProjects({ includeArchived: true }).map(p => [p.slug, p]))

  // Every referenced project must exist, or be creatable. Checked up front so a missing one writes nothing.
  const missing = data.projects.filter(p => !known.has(p.slug))
  if (missing.length && !opts.createProjects) {
    throw new ImportError(`project${missing.length === 1 ? '' : 's'} not found: ${missing.map(p => p.slug).join(', ')} (pass --create-projects to create ${missing.length === 1 ? 'it' : 'them'}, or --project to import into an existing one)`)
  }

  const attempt = async (step: ImportStep, write: () => Promise<unknown>) => {
    if (dry) { steps.push(step); return }
    try { await write(); steps.push(step) }
    catch (err) { steps.push({ ...step, action: 'failed', error: err instanceof Error ? err.message : String(err) }) }
  }

  // file slug -> real slug, per project; real slugs come back from the server when something is created.
  const projectSlugs = new Map<string, string>()
  const taskSlugs = new Map<string, Map<string, string>>()
  const docSlugs = new Map<string, Map<string, string>>()
  const followUps: (() => Promise<void>)[] = []

  for (const p of data.projects) {
    if (known.has(p.slug)) {
      projectSlugs.set(p.slug, p.slug)
      steps.push({ kind: 'project', action: 'exists', key: p.slug, slug: p.slug })
      continue
    }
    const title = p.title || p.slug
    let created = predictSlug(title) || p.slug
    await attempt({ kind: 'project', action: 'create', key: title, slug: created }, async () => {
      const r = await ops.createProject({ title, description: p.description ?? undefined, icon: p.icon ?? undefined, status: p.status, tags: p.tags, githubRepo: p.githubRepo ?? undefined })
      created = r.slug
    })
    if (steps.at(-1)!.action === 'failed') continue
    projectSlugs.set(p.slug, created)
  }

  for (const p of data.projects) {
    const project = projectSlugs.get(p.slug)
    if (!project) continue
    const existingTasks = ops.listTasks({ project, includeArchived: true })
    const map = taskSlugs.set(p.slug, new Map()).get(p.slug)!

    for (const t of p.tasks) {
      const match = existingTasks.find(e => (t.slug && e.slug === t.slug) || e.title.toLowerCase() === t.title.toLowerCase())
      const fields = {
        title: t.title, status: t.status, priority: t.priority, tags: t.tags, assignees: t.assignees,
        ...(t.due ? { due: t.due } : {}), githubIssues: t.githubIssues, githubPRs: t.githubPRs, description: t.description,
      }
      const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
      const deps = (t.dependencies ?? []).length ? t.dependencies! : undefined
      const withDeps = (slug: string) => { if (deps) followUps.push(async () => { await ops.updateTask(project, slug, { dependencies: deps.map(d => remapDependency(d, p.slug)) }) }) }

      if (match && onExists === 'skip') {
        if (t.slug) map.set(t.slug, match.slug)
        steps.push({ kind: 'task', action: 'skip', project, key: t.title, slug: match.slug })
      }
      else if (match && onExists === 'update') {
        if (t.slug) map.set(t.slug, match.slug)
        await attempt({ kind: 'task', action: 'update', project, key: t.title, slug: match.slug }, async () => {
          await ops.updateTask(project, match.slug, clean)
          if (t.archivedAt && !match.archivedAt) await ops.archiveTask(project, match.slug, true)
        })
        if (steps.at(-1)!.action !== 'failed') withDeps(match.slug)
      }
      else {
        let slug = t.slug ?? predictSlug(t.title)
        await attempt({ kind: 'task', action: 'create', project, key: t.title, slug }, async () => {
          // Only a create may name its slug (kept stable when free); an update must never write one.
          const r = await ops.createTask(project, t.slug ? { ...clean, slug: t.slug } : clean)
          slug = r.slug
          if (t.archivedAt) await ops.archiveTask(project, slug, true)
        })
        const step = steps.at(-1)!
        step.slug = slug
        if (step.action !== 'failed') { if (t.slug) map.set(t.slug, slug); withDeps(slug) }
      }
    }
  }

  // Dependencies name file slugs, which may differ from the slugs the server just assigned.
  function remapDependency(dep: string, fileProject: string) {
    if (dep.includes('/')) {
      const [proj, slug] = [dep.slice(0, dep.indexOf('/')), dep.slice(dep.indexOf('/') + 1)]
      const realProject = projectSlugs.get(proj) ?? proj
      return `${realProject}/${taskSlugs.get(proj)?.get(slug) ?? slug}`
    }
    return taskSlugs.get(fileProject)?.get(dep) ?? dep
  }

  const importDocs = async (docs: ImportDoc[], project: string | undefined, fileProject: string, existing: ReturnType<Ops['listDocsWithBody']>) => {
    const map = docSlugs.set(fileProject, new Map()).get(fileProject)!
    for (const d of docs) {
      const match = existing.find(e => (d.slug && e.slug === d.slug) || e.title.toLowerCase() === d.title.toLowerCase())
      const where = project
      if (match && onExists === 'skip') {
        if (d.slug) map.set(d.slug, match.slug)
        steps.push({ kind: 'doc', action: 'skip', project: where, key: d.title, slug: match.slug })
        continue
      }
      const parentLater = (slug: string) => {
        if (d.parent) followUps.push(async () => { await ops.updateDoc({ project, slug }, { parent: map.get(d.parent!) ?? d.parent! }) })
      }
      if (match && onExists === 'update') {
        if (d.slug) map.set(d.slug, match.slug)
        await attempt({ kind: 'doc', action: 'update', project: where, key: d.title, slug: match.slug }, async () => {
          await ops.updateDoc({ project, slug: match.slug }, { title: d.title, body: d.body, tags: d.tags })
          if (d.archivedAt && !match.archivedAt) await ops.archiveDoc({ project, slug: match.slug }, true)
        })
        if (steps.at(-1)!.action !== 'failed') parentLater(match.slug)
      }
      else {
        let slug = d.slug ?? predictSlug(d.title)
        await attempt({ kind: 'doc', action: 'create', project: where, key: d.title, slug }, async () => {
          const r = await ops.createDoc({ project, title: d.title, body: d.body, tags: d.tags, slug: d.slug })
          slug = r.slug
          if (d.archivedAt) await ops.archiveDoc({ project, slug }, true)
        })
        const step = steps.at(-1)!
        step.slug = slug
        if (step.action !== 'failed') { if (d.slug) map.set(d.slug, slug); parentLater(slug) }
      }
    }
  }

  if (opts.docs !== false) {
    for (const p of data.projects) {
      const project = projectSlugs.get(p.slug)
      if (project && p.docs.length) await importDocs(p.docs, project, p.slug, ops.listDocsWithBody({ project, includeArchived: true }))
    }
    if (data.standaloneDocs.length) await importDocs(data.standaloneDocs, undefined, '(standalone)', ops.listDocsWithBody({ standalone: true, includeArchived: true }))
  }

  // Second pass: dependencies and doc parents, now that every slug is known.
  if (!dry) {
    for (const run of followUps) {
      try { await run() }
      catch (err) { steps.push({ kind: 'task', action: 'failed', key: 'dependency or parent link', error: err instanceof Error ? err.message : String(err) }) }
    }
  }
  return steps
}
