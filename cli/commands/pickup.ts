import { defineCommand } from 'citty'
import { buildPickup, type Pickup } from '../../lib/core'
import { createContext, globalArgs } from '../context'
import { CliError, emit, ExitCode } from '../output'

const STATUS_LABEL = { 'in-progress': 'In progress', blocked: 'Blocked', 'in-review': 'In review', todo: 'Todo' } as const

// Same structure as the /pickup skill's briefing, as markdown so it reads well in a terminal and in a transcript.
// Capped sections say what was left out and how to get it.
export function renderPickup(p: Pickup, opts: { delta?: boolean } = {}) {
  const out: string[] = [`## Session Briefing: ${p.project.slug}`]

  if (p.sinceLastSession) {
    const d = p.sinceLastSession
    out.push('', `### Since last session (${d.basedOn}, ${d.since.slice(0, 16).replace('T', ' ')}Z)`)
    if (!d.changes.length && !d.docsChanged.length) out.push('Nothing changed.')
    for (const e of d.changes) out.push(`- ${e.at} ${e.type} \`${e.task}\`${e.type === 'note' ? ` (${e.author ?? 'unknown'}): ` : ` [${e.detail}]: `}${e.type === 'note' ? e.detail : e.title}`)
    if (d.moreChanges) out.push(`- … ${d.moreChanges} more (mdpm log --since ${d.since.slice(0, 10)})`)
    for (const doc of d.docsChanged) out.push(`- doc updated: ${doc.title} (\`${doc.slug}\`)`)
    out.push(`_${d.note}_`)
  }
  else if (opts.delta) out.push('', 'No previous session notes to compare against.')

  if (opts.delta) {
    if (p.blockers.length) out.push('', '### Blockers', ...p.blockers.map(b => `- \`${b.slug}\`: ${b.reason}`))
    return out.join('\n')
  }

  out.push('', `### Open Tasks (${p.openTaskCount})`)
  for (const status of Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]) {
    const tasks = p.tasks[status]
    const hidden = p.hiddenTasks?.[status] ?? 0
    if (!tasks.length) continue
    out.push('', `**${STATUS_LABEL[status]}** (${tasks.length + hidden})`)
    for (const t of tasks) out.push(`- \`${t.slug}\`: ${t.title} [${t.priority}]${t.summary ? `: ${t.summary}` : ''}`)
    if (hidden) out.push(`- … ${hidden} more (mdpm task list --status ${status})`)
  }
  if (!p.openTaskCount) out.push('', 'No open tasks.')

  if (p.blockers.length) out.push('', '### Blockers', ...p.blockers.map(b => `- \`${b.slug}\`: ${b.reason}`))

  out.push('', `### Docs (${p.docCount})`)
  for (const d of p.docs) out.push(`- ${d.highPriority ? '⭐ ' : ''}${d.title} (\`${d.slug}\`)${d.summary ? `: ${d.summary}` : ''}`)
  if (p.hiddenDocs) out.push(`- … ${p.hiddenDocs} more (mdpm doc list)`)
  if (p.sessionNotesCount) out.push(`- ${p.sessionNotesCount} session-notes doc${p.sessionNotesCount === 1 ? '' : 's'} (latest shown below)${p.compactionHint ? `; ${p.compactionHint}` : ''}`)
  if (p.docs.some(d => d.highPriority)) out.push('', '⭐ = tagged architecture, decisions, or context: read first.')

  out.push('', '### Last Session Notes')
  if (p.lastSessionNotes) {
    out.push(`_${p.lastSessionNotes.title}_ (\`${p.lastSessionNotes.slug}\`)`, '', p.lastSessionNotes.body)
    if (p.lastSessionNotes.truncated) out.push('', `_… cut at ${p.lastSessionNotes.body.length} of ${p.lastSessionNotes.totalChars} chars: mdpm doc show ${p.lastSessionNotes.slug} --offset ${p.lastSessionNotes.body.length}_`)
  }
  else out.push('No previous session notes found.')

  out.push('', '### Suggested Focus', '_Picked by rule: in-progress first, then todo by priority and board order, then in-review._')
  p.suggestedFocus.forEach((t, i) => out.push(`${i + 1}. \`${t.slug}\`: ${t.title} [${t.status}, ${t.priority}]`))
  if (!p.suggestedFocus.length) out.push('Nothing open.')
  return out.join('\n')
}

export default defineCommand({
  meta: { name: 'pickup', description: 'Session briefing for a project: open tasks, docs, and the latest session notes' },
  args: {
    ...globalArgs,
    delta: { type: 'boolean', description: 'Only what changed since the last handoff, plus blockers', default: false },
    full: { type: 'boolean', description: 'No caps: every task and doc, the whole last session notes', default: false },
    ref: { type: 'positional', description: 'Project slug or unique fragment (default: current repo\'s project)', required: false },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const slug = args.ref ? ctx.core.resolveProject(args.ref).slug : ctx.inferProject()?.slug
    if (!slug) throw new CliError('no project: name one, or run inside a repo registered in mdpm (see `mdpm config show`)', ExitCode.usage)
    const pickup = buildPickup(ctx.core, slug, { full: args.full, ...(args.delta && { deltaEntries: 30 }) })
    const view = args.delta ? { project: pickup.project, sinceLastSession: pickup.sinceLastSession, blockers: pickup.blockers } : pickup
    emit(ctx.json, view, () => renderPickup(pickup, { delta: args.delta }))
  },
})
