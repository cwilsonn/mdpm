import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import matter from 'gray-matter'
import { REPO_ROOT } from '../config'
import { stateDir } from '../lifecycle'
import { applyToText, hasLegacyFields, migrateLegacy, projectRepoOf, type FileKind, type LegacyMigration } from './legacy-links'

// Content schema versions: 1 = legacy GitHub fields, 2 = links (design doc, section 8).
// State is derived from the content itself (any file still using a legacy field is "pending");
// the marker file records when and by which mdpm version it was migrated, and guards downgrades.

export const SCHEMA_VERSION = 2
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

  const projects = existsSync(projectsDir) ? readdirSync(projectsDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort() : []
  for (const slug of opts.project ? projects.filter(p => p === opts.project) : projects) {
    const dir = join(projectsDir, slug)
    const indexPath = join(dir, 'index.md')
    let repo: string | null = null
    try {
      repo = existsSync(indexPath) ? projectRepoOf(matter(readFileSync(indexPath, 'utf8')).data) : null
    }
    catch {}

    const files: [string, FileKind][] = [
      ...(existsSync(indexPath) ? [[indexPath, 'project'] as [string, FileKind]] : []),
      ...listMd(join(dir, 'tasks')).map(f => [join(dir, 'tasks', f), 'task'] as [string, FileKind]),
    ]
    for (const [path, kind] of files) {
      const rel = relative(contentRoot, path)
      if (only && rel !== only) continue
      scanned++
      let text: string
      try {
        text = readFileSync(path, 'utf8')
        const data = matter(text).data
        if (!hasLegacyFields(data)) continue
        const migration: LegacyMigration = migrateLegacy(kind, data, repo)
        if (!migration.remove.length && !migration.added.length) {
          // Nothing convertible (everything left in place); still worth reporting.
          if (migration.unresolved.length) entries.push({ file: rel, kind, changes: [], unresolved: migration.unresolved })
          continue
        }
        entries.push({ file: rel, kind, changes: migration.changes, unresolved: migration.unresolved, newText: applyToText(text, migration) })
      }
      catch (err) {
        entries.push({ file: rel, kind, changes: [], unresolved: [], error: (err as Error).message })
      }
    }
  }
  if (only && scanned === 0) throw new MigrationError(`${only} is not a project or task file`)
  return { contentRoot, scanned, entries }
}

export interface SchemaStatus {
  version: number
  marker?: SchemaMarker
  // Files that still use legacy fields and would be changed by `mdpm migrate`.
  pendingFiles: number
  // Files that use legacy fields mdpm could not convert (reported by `mdpm migrate`).
  blockedFiles: number
  // The content was last written by a newer mdpm than this one.
  newerThanCode: boolean
}

export function schemaStatus(contentRoot: string): SchemaStatus {
  const marker = readSchemaMarker(contentRoot)
  const plan = planMigration(contentRoot)
  const pendingFiles = plan.entries.filter(e => e.newText !== undefined).length
  return {
    version: pendingFiles ? 1 : SCHEMA_VERSION,
    ...(marker && { marker }),
    pendingFiles,
    blockedFiles: plan.entries.filter(e => e.newText === undefined).length,
    newerThanCode: !!marker && marker.schemaVersion > SCHEMA_VERSION,
  }
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

  for (const entry of writes) {
    const path = join(plan.contentRoot, entry.file)
    const tmp = `${path}.mdpm-tmp`
    try {
      writeFileSync(tmp, entry.newText!, 'utf8')
      // Re-read what is on disk before it replaces the original.
      if (matter(readFileSync(tmp, 'utf8')).content !== matter(readFileSync(path, 'utf8')).content) throw new MigrationError('the body changed')
      renameSync(tmp, path)
    }
    catch (err) {
      rmSync(tmp, { force: true })
      throw new MigrationError(`${entry.file}: ${(err as Error).message}${result.applied.length ? ` (${result.applied.length} file(s) were already migrated; re-run to continue)` : ''}`)
    }
    result.applied.push(entry.file)
  }

  // Stamp only when nothing legacy remains anywhere (a --file/--project run is not the whole job).
  if (schemaStatus(plan.contentRoot).pendingFiles === 0 && (writes.length || !readSchemaMarker(plan.contentRoot))) {
    const marker: SchemaMarker = { schemaVersion: SCHEMA_VERSION, migratedAt: (opts.now ?? new Date()).toISOString(), migratedBy: mdpmVersion() }
    writeFileSync(join(plan.contentRoot, MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
    result.stamped = true
  }
  return result
}

