import type { FileKind, FileMigration } from './links-to-body'

// Migration 004: frontmatter mdpm no longer reads. Assignees were removed (no assignee on tasks, no project
// default), so `assignees` and `defaultAssignee` go, and the `content/authors/` records that fed the assignee
// picker are deleted. Empty `tags` and `dependencies` lists go too: every reader defaults them to [] and the
// writer no longer writes them, so leaving them is noise in every read and diff.
export const DROPPED_KEYS: Record<FileKind, readonly string[]> = {
  task: ['assignees'],
  project: ['defaultAssignee'],
  doc: [],
}
const EMPTY_LIST_KEYS = ['tags', 'dependencies'] as const

/** The frontmatter keys to drop from one file (only those present); empty when there is nothing to do. */
export function trimmedKeys(kind: FileKind, data: Record<string, unknown>): string[] {
  const remove = DROPPED_KEYS[kind].filter(k => k in data)
  for (const k of EMPTY_LIST_KEYS) if (Array.isArray(data[k]) && !(data[k] as unknown[]).length) remove.push(k)
  return remove
}

export function trimMigration(remove: string[]): FileMigration {
  return { remove, lines: [], changes: [`drop ${remove.join(', ')}`], unresolved: [] }
}
