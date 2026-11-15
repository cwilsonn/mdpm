import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import matter from 'gray-matter'
import { REPO_ROOT } from '../config'
import { stateDir } from '../lifecycle'
import { notesFileOf } from '../notes'
import { applyToText, hasLegacyKeys, planFile, repoUrlOf, type FileKind } from './links-to-body'
import { planNotesMove } from './notes-to-sidecar'
import { withFileLock } from '../write'

// Content schema versions: 1 = legacy GitHub fields, 2 = `links` (never shipped to real content),
// 3 = no link fields: links live in the body, a project's repository is one `repo:` URL.
// 4 = task notes live in `tasks/notes/<slug>.md`, not in the task body.
// State is derived from the content itself (a file still carrying githubRepo/githubIssues/githubPRs/links, or a
// task body still holding notes, is "pending"); the marker file records when and by which mdpm version it was
// migrated. The migrations chain per file: 003 is planned on 002's output, so a file gets one entry.

export const SCHEMA_VERSION = 4

/** Which migration a change belongs to, and the schema version content is at while it is pending. */
export type MigrationId = 'links' | 'notes'
const PENDING_VERSION: Record<MigrationId, number> = { links: 2, notes: 3 }
export const MARKER_FILE = '.mdpm-schema.json'

export interface SchemaMarker {
  schemaVersion: number
  migratedAt: string
  migratedBy: string
}

export interface PlanEntry {
  // Relative to the content root, e.g. projects/acme/tasks/fix-bug.md
  file: string
  kind: FileKind
  changes: string[]
  unresolved: string[]
  // Present when the file needs a text change; absent when there is nothing to write.
  newText?: string
  // Migration 003: the task's notes file to write first (relative path and full new text), when it changes.
  sidecar?: { file: string; text: string }
  // What the plan was made from: the file's text, and for a task its notes file (relative path and text, '' when
  // missing). Apply refuses an entry whose files changed since, so a write landing in between is never lost.
  basis?: { text: string; notesFile?: string; notesText?: string }
  migrations: MigrationId[]
  // Set when the file cannot be migrated safely (nothing is written for it).
  error?: string
}

export interface MigrationPlan {
  contentRoot: string
  scanned: number
  entries: PlanEntry[]
}

export interface PlanOptions {
  // A single file (absolute, relative to the cwd, or relative to the content root).
  file?: string
  project?: string
}

export class MigrationError extends Error {
  override name = 'MigrationError'
}

const listMd = (dir: string) => existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.md')).sort() : []

export function readSchemaMarker(contentRoot: string): SchemaMarker | undefined {
  try {
    const marker = JSON.parse(readFileSync(join(contentRoot, MARKER_FILE), 'utf8'))
    return typeof marker?.schemaVersion === 'number' ? marker : undefined
  }
  catch {
    return undefined
  }
}

function resolveFile(contentRoot: string, file: string) {
  const candidates = isAbsolute(file) ? [file] : [resolve(file), join(contentRoot, file)]
  const found = candidates.find(existsSync)
  if (!found) throw new MigrationError(`no such file: ${file}`)
  const rel = relative(contentRoot, found)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new MigrationError(`${file} is outside the content directory`)
  return rel
}

export function planMigration(contentRoot: string, opts: PlanOptions = {}): MigrationPlan {
  const only = opts.file ? resolveFile(contentRoot, opts.file) : undefined
  const projectsDir = join(contentRoot, 'projects')
  const entries: PlanEntry[] = []
  let scanned = 0

  const consider = (path: string, kind: FileKind, repoUrl: string | undefined) => {
    const rel = relative(contentRoot, path)
    if (only && rel !== only) return
    scanned++
    const migrations: MigrationId[] = []
    try {
      const original = readFileSync(path, 'utf8')
      const changes: string[] = []
      const unresolved: string[] = []
      let text = original
      let sidecar: PlanEntry['sidecar']
      let notesBasis: { notesFile: string; notesText: string } | undefined
      const data = matter(original).data
      if (hasLegacyKeys(data)) {
        migrations.push('links')
        const migration = planFile(kind, data, repoUrl)
        text = applyToText(text, migration)
        changes.push(...migration.changes)
        unresolved.push(...migration.unresolved)
      }
      if (kind === 'task') {
        const notesPath = notesFileOf(dirname(path), basename(path, '.md'))
        notesBasis = { notesFile: relative(contentRoot, notesPath), notesText: existsSync(notesPath) ? readFileSync(notesPath, 'utf8') : '' }
        const move = planNotesMove(text, notesBasis.notesText)
        if (move) {
          migrations.push('notes')
          text = move.taskText
          if (move.notesText !== undefined) sidecar = { file: relative(contentRoot, notesPath), text: move.notesText }
          changes.push(`${move.moved} note(s) move to ${relative(contentRoot, notesPath)}`)
        }
      }
      if (!migrations.length) return
      entries.push({ file: rel, kind, changes, unresolved, newText: text, ...(sidecar && { sidecar }), basis: { text: original, ...notesBasis }, migrations })
    }
    catch (err) {
      entries.push({ file: rel, kind, changes: [], unresolved: [], error: (err as Error).message, migrations })
    }
  }

  const projects = existsSync(projectsDir) ? readdirSync(projectsDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort() : []
  for (const slug of opts.project ? projects.filter(p => p === opts.project) : projects) {
    const dir = join(projectsDir, slug)
    const indexPath = join(dir, 'index.md')
    let repoUrl: string | undefined
    try {
      if (existsSync(indexPath)) {
        const data = matter(readFileSync(indexPath, 'utf8')).data
        repoUrl = repoUrlOf(data) ?? (typeof data.repo === 'string' ? data.repo : undefined)
      }
    }
    catch {}
    if (existsSync(indexPath)) consider(indexPath, 'project', repoUrl)
    for (const f of listMd(join(dir, 'tasks'))) consider(join(dir, 'tasks', f), 'task', repoUrl)
    for (const f of listMd(join(dir, 'docs'))) consider(join(dir, 'docs', f), 'doc', repoUrl)
  }
  if (!opts.project) {
    for (const f of listMd(join(contentRoot, 'docs'))) consider(join(contentRoot, 'docs', f), 'doc', undefined)
  }
  if (only && scanned === 0) throw new MigrationError(`${only} is not a project, task or doc file`)
  return { contentRoot, scanned, entries }
}

export interface SchemaStatus {
  version: number
  marker?: SchemaMarker
  // Files that still need a migration (link fields, notes in a task body) and would be changed by `mdpm migrate`.
  pendingFiles: number
  // Pending files per migration.
  pendingBy: Record<MigrationId, number>
  // Files mdpm could not convert safely (reported by `mdpm migrate`).
  blockedFiles: number
  // The content was last written by a newer mdpm than this one.
  newerThanCode: boolean
}

export function schemaStatus(contentRoot: string): SchemaStatus {
  const marker = readSchemaMarker(contentRoot)
  const plan = planMigration(contentRoot)
  const pendingEntries = plan.entries.filter(e => e.newText !== undefined)
  const pending = { links: 0, notes: 0 }
  for (const e of plan.entries) for (const m of e.migrations) pending[m]++
  const oldest = (Object.keys(PENDING_VERSION) as MigrationId[]).filter(m => pending[m]).map(m => PENDING_VERSION[m])
  return {
    version: oldest.length ? Math.min(...oldest) : SCHEMA_VERSION,
    ...(marker && { marker }),
    pendingFiles: pendingEntries.length,
    pendingBy: pending,
    blockedFiles: plan.entries.filter(e => e.newText === undefined).length,
    newerThanCode: !!marker && marker.schemaVersion > SCHEMA_VERSION,
  }
}

/** "3 file(s) still carry link fields, 120 task(s) still hold notes in the body" */
export function pendingSummary(by: Record<MigrationId, number>) {
  return [by.links && `${by.links} file(s) still carry link fields`, by.notes && `${by.notes} task(s) still hold notes in the body`].filter(Boolean).join(', ')
}

export interface ApplyOptions {
  backup?: boolean
  now?: Date
}

export interface ApplyResult {
  applied: string[]
  backupDir?: string
  stamped: boolean
}

const mdpmVersion = () => JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version as string

// Write the planned changes: backup first, then each file via temp file + verify + rename, so a
// crash leaves every file either old or new, never half-written. Idempotent: re-running is a no-op.
export function applyMigration(plan: MigrationPlan, opts: ApplyOptions = {}): ApplyResult {
  const broken = plan.entries.filter(e => e.error)
  if (broken.length) {
    throw new MigrationError(`${broken.length} file(s) cannot be migrated safely, nothing was written:\n${broken.map(e => `  ${e.file}: ${e.error}`).join('\n')}`)
  }
  const writes = plan.entries.filter(e => e.newText !== undefined)
  const result: ApplyResult = { applied: [], stamped: false }

  if (writes.length && opts.backup !== false) {
    const stamp = (opts.now ?? new Date()).toISOString().replace(/[:.]/g, '-')
    result.backupDir = join(stateDir(), 'backups', `content-${stamp}`)
    mkdirSync(dirname(result.backupDir), { recursive: true })
    cpSync(plan.contentRoot, result.backupDir, { recursive: true })
  }

  // Temp file, read back, rename: a crash leaves the file old or new.
  const replace = (path: string, text: string) => {
    const tmp = `${path}.mdpm-tmp`
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(tmp, text, 'utf8')
      // Re-read what is on disk before it replaces the original (the planned text was verified when planned).
      if (readFileSync(tmp, 'utf8') !== text) throw new MigrationError('the written file does not match the plan')
      renameSync(tmp, path)
    }
    finally {
      rmSync(tmp, { force: true })
    }
  }

  for (const entry of writes) {
    try {
      // The notes file first: a crash before the task file is rewritten leaves the notes in both places, which
      // readers merge and a re-run finishes; never in neither.
      // Under the writer's own locks (task file, then notes file: the order updateTask takes them), and only if
      // neither file changed since it was planned: a note appended meanwhile would otherwise be overwritten.
      const full = join(plan.contentRoot, entry.file)
      const notesFull = entry.basis?.notesFile !== undefined ? join(plan.contentRoot, entry.basis.notesFile) : undefined
      const readOr = (p: string) => existsSync(p) ? readFileSync(p, 'utf8') : ''
      const write = () => {
        if (entry.basis && (readOr(full) !== entry.basis.text || (notesFull && readOr(notesFull) !== entry.basis.notesText))) {
          throw new MigrationError('changed since it was planned; re-run')
        }
        if (entry.sidecar) replace(join(plan.contentRoot, entry.sidecar.file), entry.sidecar.text)
        replace(full, entry.newText!)
      }
      withFileLock(full, () => notesFull && entry.migrations.includes('notes') ? withFileLock(notesFull, write) : write())
    }
    catch (err) {
      throw new MigrationError(`${entry.file}: ${(err as Error).message}${result.applied.length ? ` (${result.applied.length} file(s) were already migrated; re-run to continue)` : ''}`)
    }
    result.applied.push(entry.file)
  }

  // Stamp only when nothing is pending anywhere (a --file/--project run is not the whole job).
  if (schemaStatus(plan.contentRoot).pendingFiles === 0 && (writes.length || !readSchemaMarker(plan.contentRoot))) {
    const marker: SchemaMarker = { schemaVersion: SCHEMA_VERSION, migratedAt: (opts.now ?? new Date()).toISOString(), migratedBy: mdpmVersion() }
    writeFileSync(join(plan.contentRoot, MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
    result.stamped = true
  }
  return result
}

