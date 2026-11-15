import { isDeepStrictEqual } from 'node:util'
import matter from 'gray-matter'
import { addNotesToText, firstNoteIndex, parseNotes, splitNotes, type ParsedNote } from '../notes'

// Migration 003: a task's notes leave its body for its notes file, `tasks/notes/<slug>.md` (spec vs history).
//
// The task file keeps its frontmatter byte for byte and its body up to the first note; the notes move as
// they are (raw text) into the notes file, or are merged into one that already exists (notes written there
// by a newer mdpm while older code still appended to the body), dropping duplicates. Both results are
// parsed back and compared before anything is written. Re-running after a partial apply is a no-op for
// notes already moved.
//
// Readers merge notes from both places, so content that has not run this still reads correctly.

export class NotesMigrationError extends Error {
  override name = 'NotesMigrationError'
}

export interface NotesMove {
  /** The task file without its notes. */
  taskText: string
  /** The notes file's new text, or undefined when it already holds every note. */
  notesText?: string
  moved: number
}

const key = (n: ParsedNote) => `${n.at.getTime()}|${n.author ?? ''}|${n.text}`

export const hasInlineNotes = (body: string) => splitNotes(body).notes.length > 0

/** Plan moving a task file's notes into its notes file (`existingNotes`: its current text, '' if none). */
export function planNotesMove(text: string, existingNotes: string): NotesMove | null {
  if (text.includes('\r')) throw new NotesMigrationError('CRLF line endings are not supported')
  if (!text.startsWith('---\n')) throw new NotesMigrationError('no frontmatter block found')
  const close = text.indexOf('\n---', 3)
  if (close < 0) throw new NotesMigrationError('no frontmatter block found')
  const afterClose = close + 4
  if (text[afterClose] !== undefined && text[afterClose] !== '\n') throw new NotesMigrationError('malformed frontmatter delimiter')
  const bodyStart = text[afterClose] === '\n' ? afterClose + 1 : afterClose
  const head = text.slice(0, bodyStart)
  const body = text.slice(bodyStart)

  const split = splitNotes(body)
  if (!split.notes.length) return null
  // What precedes the first note (its `---` separator excluded), trailing whitespace dropped.
  const specRaw = body.slice(0, firstNoteIndex(body)).trimEnd()
  const taskText = `${head}${specRaw ? `${specRaw}\n` : ''}`
  // A fresh notes file takes the notes byte for byte; an existing one gets the missing ones merged in.
  const notesText = existingNotes.trim() ? addNotesToText(existingNotes, split.notes) ?? undefined : `${split.notesText}\n`

  // Check: frontmatter unchanged, spec unchanged and note-free, and the notes file holds every note once.
  const before = matter(text)
  const after = matter(taskText)
  if (!isDeepStrictEqual(after.data, before.data)) throw new NotesMigrationError('the frontmatter changed')
  const afterSplit = splitNotes(after.content)
  if (afterSplit.notes.length) throw new NotesMigrationError('notes remain in the body')
  if (afterSplit.spec !== split.spec) throw new NotesMigrationError('the spec changed')
  const want = new Set([...split.notes, ...parseNotes(existingNotes)].map(key))
  const got = new Set(parseNotes(notesText ?? existingNotes).map(key))
  if (!isDeepStrictEqual([...got].sort(), [...want].sort())) throw new NotesMigrationError('the notes file would not hold exactly the notes')
  return { taskText, ...(notesText !== undefined && { notesText }), moved: split.notes.length }
}
