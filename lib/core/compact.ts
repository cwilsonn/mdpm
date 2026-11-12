import type { Ops } from './ops'
import { sessionNotesOrder } from './pickup'

// Rolling compaction of session notes. Every /handoff adds a doc, so a long-lived project collects dozens that
// no one reads. Past the newest `keep`, each is reduced to a short digest in ONE archive doc and the original is
// archived (never deleted: it stays readable and `unarchive_doc` brings it back).

export const ROLLUP_SLUG = 'notes-rollup'
export const DEFAULT_KEEP = 5
const DIGEST_LINES = 4
const LINE_CHARS = 160
const ROLLUP_MAX_CHARS = 24_000

type Doc = ReturnType<Ops['listDocsWithBody']>[number]

// The rollup's slug deliberately avoids "session-notes": pickup treats such docs as session notes and would read it as the latest.
export const isRollup = (doc: Pick<Doc, 'slug'>) => doc.slug === ROLLUP_SLUG
export const isSessionNotesDoc = (doc: Doc) => !isRollup(doc) && (doc.tags.includes('session-notes') || doc.slug.includes('session-notes'))

// The first few substantive lines of a notes doc: what was done, in the author's own words.
export function digest(body: string) {
  const lines = body.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && !/^[-*_]{3,}$/.test(l))
  return lines.slice(0, DIGEST_LINES).map((l) => {
    const plain = l.replace(/\*\*/g, '').replace(/`/g, '')
    const text = plain.length > LINE_CHARS ? `${plain.slice(0, LINE_CHARS - 1)}…` : plain
    return /^[-*]\s/.test(text) ? text : `- ${text}`
  }).join('\n')
}

interface Entry { slug: string; text: string }

const heading = (slug: string, title: string) => `### ${slug} — ${title}`

// `### slug — title` followed by its digest, up to the next heading.
function parseRollup(body: string): Entry[] {
  const parts = body.split(/^(?=### )/m).filter(p => p.startsWith('### '))
  return parts.map(p => ({ slug: p.slice(4, p.indexOf(' — ') > 0 ? p.indexOf(' — ') : p.indexOf('\n')).trim(), text: p.trim() }))
}

function renderRollup(entries: Entry[]) {
  const head = `Older session notes, one digest each (newest first). The originals are archived, not deleted: \`mdpm doc unarchive <slug>\` restores one.\n`
  let kept = entries.map(e => e.text)
  // Over the cap, the oldest entries shrink to their heading line.
  let body = `${head}\n${kept.join('\n\n')}\n`
  for (let i = kept.length - 1; body.length > ROLLUP_MAX_CHARS && i >= 0; i--) {
    kept = kept.map((t, j) => (j === i ? t.split('\n')[0]! : t))
    body = `${head}\n${kept.join('\n\n')}\n`
  }
  return body
}

export interface CompactionPlan {
  project: string
  keep: number
  /** Newest first; stay as they are. */
  kept: { slug: string; title: string }[]
  /** Newest first; to be digested into the rollup and archived. */
  compacted: { slug: string; title: string; digest: string }[]
  rollup: { slug: string; title: string; existing: boolean; body: string; chars: number }
}

export function planCompaction(ops: Ops, project: string, opts: { keep?: number } = {}): CompactionPlan {
  const keep = Math.max(1, opts.keep ?? DEFAULT_KEEP)
  const docs = ops.listDocsWithBody({ project })
  const notes = docs.filter(isSessionNotesDoc).sort(sessionNotesOrder)
  const old = notes.slice(keep)
  const existing = docs.find(isRollup)
  const fresh: Entry[] = old.map(d => ({ slug: d.slug, text: `${heading(d.slug, d.title)}\n${digest(d.body)}` }))
  const previous = existing ? parseRollup(existing.body).filter(e => !fresh.some(f => f.slug === e.slug)) : []
  // Compaction always takes the oldest remaining notes, so this batch is newer than anything already rolled up.
  const body = renderRollup([...fresh, ...previous])
  return {
    project,
    keep,
    kept: notes.slice(0, keep).map(d => ({ slug: d.slug, title: d.title })),
    compacted: old.map((d, i) => ({ slug: d.slug, title: d.title, digest: fresh[i]!.text.split('\n').slice(1).join('\n') })),
    rollup: { slug: ROLLUP_SLUG, title: 'Session notes — rollup', existing: !!existing, body, chars: body.length },
  }
}

// Writes the rollup first, then archives the originals, so an interruption never loses a digest.
export async function applyCompaction(ops: Ops, plan: CompactionPlan) {
  if (!plan.compacted.length) return { archived: [] as string[] }
  await ops.upsertDoc({ project: plan.project, slug: plan.rollup.slug, title: plan.rollup.title, body: plan.rollup.body, tags: ['archive'] })
  const archived: string[] = []
  for (const d of plan.compacted) {
    await ops.archiveDoc({ project: plan.project, slug: d.slug })
    archived.push(d.slug)
  }
  return { archived }
}
