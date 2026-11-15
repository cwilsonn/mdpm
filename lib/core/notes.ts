import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// A task's notes (its append-only history) live in a sidecar file next to the task, so the task body is
// only the spec: `projects/<p>/tasks/<slug>.md` and `projects/<p>/tasks/notes/<slug>.md`. The sidecar sits
// in a subdirectory on purpose: everything that lists `tasks/*.md` skips it without knowing about it.
//
// A notes file is plain markdown with no frontmatter: notes in the format below, oldest first, joined by
// `\n\n---\n`. Older content (and older mdpm versions, still running somewhere) keep notes appended to the
// task body instead, so readers always merge both places: see `taskNotes`.

export interface ParsedNote {
  /** UTC; notes are stamped with toISOString(), minute precision. */
  at: Date
  author?: string
  text: string
}

export const NOTES_DIR = 'notes'
export const NOTE_SEPARATOR = '\n\n---\n'

// `**Note** _(2026-10-01 17:47)_` optionally followed by ` by <author>`, then a blank line and the text.
// Notes written before authors existed have no `by`.
const NOTE_RE = /\*\*Note\*\* _\((\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})\)_(?: by ([^\n]+))?\n\n([\s\S]*?)(?=\n\n---\n\*\*Note\*\* _\(|$)/g
const FIRST_NOTE_RE = /(?:^|\n\n---\n)\*\*Note\*\* _\(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)_/

export function parseNotes(text: string): ParsedNote[] {
  return [...text.matchAll(NOTE_RE)].map(m => ({
    at: new Date(`${m[1]}T${m[2]}:00Z`),
    author: m[3]?.trim() || undefined,
    text: m[4]!.trim(),
  }))
}

// A body in the old layout is the spec followed by appended notes. Splits them; `spec` is everything before
// the first note, `notesText` the raw notes (empty when there are none).
/** Where the notes start in an old-layout body (at the `---` before the first note), or -1. */
export const firstNoteIndex = (body: string) => body.search(FIRST_NOTE_RE)

export function splitNotes(body: string): { spec: string; notes: ParsedNote[]; notesText: string } {
  const first = firstNoteIndex(body)
  if (first < 0) return { spec: body.trim(), notes: [], notesText: '' }
  const notesText = body.slice(first).replace(/^\n\n---\n/, '').trim()
  return { spec: body.slice(0, first).trim(), notes: parseNotes(notesText), notesText }
}

export const noteStamp = (at: Date) => at.toISOString().replace('T', ' ').slice(0, 16)

export function formatNote(note: ParsedNote) {
  return `**Note** _(${noteStamp(note.at)})_${note.author?.trim() ? ` by ${note.author.trim()}` : ''}\n\n${note.text.trim()}`
}

/** A new note, stamped to the minute like every stored note (so parse(format(n)) == n). */
export function makeNote(text: string, author?: string, now = new Date()): ParsedNote {
  return { at: new Date(`${noteStamp(now).replace(' ', 'T')}:00Z`), author: author?.trim() || undefined, text: text.trim() }
}

const noteKey = (n: ParsedNote) => `${n.at.getTime()}\u0000${n.author ?? ''}\u0000${n.text}`

/** Several note lists as one: duplicates (same minute, author and text) dropped, oldest first, stable. */
export function mergeNotes(...lists: ParsedNote[][]): ParsedNote[] {
  const seen = new Set<string>()
  const out: ParsedNote[] = []
  for (const n of lists.flat()) {
    const k = noteKey(n)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(n)
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime())
}

/**
 * The notes file's text after adding notes, or null when nothing is added. `moved` are notes found elsewhere
 * (an old-layout body, a pasted description): ones already in the file are skipped, older ones go in front.
 * `appended` are notes written now, added at the end as given: writing the same note twice keeps both.
 * Existing text is kept byte for byte (hand edits survive).
 */
export function addNotesToText(existing: string, moved: ParsedNote[], appended: ParsedNote[] = []): string | null {
  const current = parseNotes(existing)
  const known = new Set(current.map(noteKey))
  const fresh = mergeNotes(moved).filter(n => !known.has(noteKey(n)))
  if (!fresh.length && !appended.length) return null
  const firstAt = current[0]?.at.getTime() ?? Infinity
  const before = fresh.filter(n => n.at.getTime() < firstAt).map(formatNote)
  const after = fresh.filter(n => n.at.getTime() >= firstAt).map(formatNote)
  return `${[...before, existing.trim(), ...after, ...appended.map(formatNote)].filter(Boolean).join(NOTE_SEPARATOR)}\n`
}

/** A task's spec and notes, from its body and its notes file (both are read: see the header). */
export function taskNotes(body: string, notesFileText: string): { spec: string; notes: ParsedNote[] } {
  const inline = splitNotes(body)
  const fileNotes = parseNotes(notesFileText)
  // Only notes in both places are duplicates (moved, or written by old and new code); the file keeps repeats.
  const known = new Set(fileNotes.map(noteKey))
  const extra = inline.notes.filter(n => !known.has(noteKey(n)))
  return { spec: inline.spec, notes: [...extra, ...fileNotes].sort((a, b) => a.at.getTime() - b.at.getTime()) }
}

// ── Paths ──

export const notesDirOf = (tasksDir: string) => join(tasksDir, NOTES_DIR)
export const notesFileOf = (tasksDir: string, slug: string) => join(tasksDir, NOTES_DIR, `${slug}.md`)

/** Slugs that have a notes file in this tasks directory (one directory read instead of a stat per task). */
export function notesSlugs(tasksDir: string): Set<string> {
  const dir = notesDirOf(tasksDir)
  if (!existsSync(dir)) return new Set()
  return new Set(readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('.')).map(f => f.slice(0, -3)))
}

export function readNotesFile(tasksDir: string, slug: string): string {
  try {
    return readFileSync(notesFileOf(tasksDir, slug), 'utf-8')
  }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw err
  }
}
