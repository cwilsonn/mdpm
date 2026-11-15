// Live updates: watch the content directory and report which record changed.
// Every writer (the web app, the CLI, the MCP server, an editor, git) ends up as a file change,
// so the watcher is the single source of change events; nothing else emits them.
import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

export type ContentKind = 'project' | 'task' | 'doc' | 'standalone-doc' | 'author'

export interface ContentEvent {
  kind: ContentKind
  /** Owning project (tasks, project docs, the project itself). */
  project?: string
  slug: string
  op: 'change' | 'delete'
  /** The record's updatedAt after the change, when it has one (lets an open editor ignore its own save). */
  updatedAt?: string | null
}

type Target = Omit<ContentEvent, 'op' | 'updatedAt'> & { file?: string }

/**
 * Map a path relative to the content root to the record it belongs to, or null for anything
 * that isn't content: dot-files (the writer's temp and lock files, .mdpm-schema.json), non-markdown files.
 * A bare project directory maps to its project (a project delete removes the whole directory).
 */
export function mapContentPath(rel: string): Target | null {
  const parts = rel.split(/[\\/]/).filter(Boolean)
  if (!parts.length || parts.some(p => p.startsWith('.'))) return null
  const last = parts[parts.length - 1]!
  const md = last.endsWith('.md')
  const base = md ? last.slice(0, -3) : last

  if (parts[0] === 'projects' && parts.length >= 2) {
    const project = parts[1]!
    if (parts.length === 2) return { kind: 'project', project, slug: project }
    if (parts.length === 3 && last === 'index.md') return { kind: 'project', project, slug: project, file: rel }
    if (parts.length === 4 && md && (parts[2] === 'tasks' || parts[2] === 'docs')) {
      return { kind: parts[2] === 'tasks' ? 'task' : 'doc', project, slug: base, file: rel }
    }
    // tasks/ or docs/ directory itself (created or removed with the project): report the project.
    if (parts.length === 3 && !md) return { kind: 'project', project, slug: project }
    return null
  }
  if (parts.length === 2 && md && parts[0] === 'docs') return { kind: 'standalone-doc', slug: base, file: rel }
  if (parts.length === 2 && md && parts[0] === 'authors') return { kind: 'author', slug: base, file: rel }
  return null
}

const UPDATED_AT = /^updatedAt:\s*['"]?([^'"\n]+?)['"]?\s*$/m

/** The frontmatter updatedAt of a markdown file, read without a YAML parser (only the first block). */
export function readUpdatedAt(full: string): string | null {
  try {
    const text = readFileSync(full, 'utf8')
    if (!text.startsWith('---')) return null
    const end = text.indexOf('\n---', 3)
    const m = UPDATED_AT.exec(end === -1 ? text : text.slice(0, end))
    return m ? m[1]! : null
  }
  catch {
    return null
  }
}

export interface ContentWatcher { close(): void }

/**
 * Watch `root` recursively and call `onEvent` once per changed record, after `coalesceMs` of quiet
 * on that record (an atomic write is a temp-file create plus a rename; a reorder rewrites many files).
 * Uses fs.watch's native recursive mode (macOS, Windows, and Linux on Node 20+). Filesystems without
 * change notifications (a WSL checkout on /mnt/c) report nothing; pages then update on navigation as before.
 */
export function createContentWatcher(
  root: string,
  onEvent: (e: ContentEvent) => void,
  { coalesceMs = 100, onError }: { coalesceMs?: number, onError?: (err: Error) => void } = {},
): ContentWatcher {
  const pending = new Map<string, ReturnType<typeof setTimeout>>()
  let closed = false

  function fire(key: string, target: Target, full: string) {
    pending.delete(key)
    if (closed) return
    const exists = existsSync(full)
    // A directory only matters when it goes away (a project delete); its contents report their own changes.
    if (!target.file && exists) return
    const event: ContentEvent = { kind: target.kind, slug: target.slug, op: exists ? 'change' : 'delete' }
    if (target.project) event.project = target.project
    if (exists && target.file) event.updatedAt = readUpdatedAt(full)
    onEvent(event)
  }

  let watcher: FSWatcher
  try {
    watcher = watch(root, { recursive: true }, (_type, filename) => {
      if (!filename || closed) return
      const rel = filename.toString()
      const target = mapContentPath(rel)
      if (!target) return
      const key = `${target.kind}:${target.project ?? ''}:${target.slug}`
      // A record's file path, or the directory that was touched (project delete).
      const full = join(root, ...(target.file ?? rel).split(/[\\/]/))
      const prev = pending.get(key)
      if (prev) clearTimeout(prev)
      pending.set(key, setTimeout(fire, coalesceMs, key, target, full))
    })
  }
  catch (err) {
    onError?.(err as Error)
    return { close() {} }
  }
  watcher.on('error', err => onError?.(err))

  return {
    close() {
      closed = true
      for (const t of pending.values()) clearTimeout(t)
      pending.clear()
      watcher.close()
    },
  }
}
