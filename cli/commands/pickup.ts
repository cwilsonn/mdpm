import { defineCommand } from 'citty'
import { buildPickup, type Pickup } from '../../lib/core'
import { createContext, globalArgs } from '../context'
import { CliError, emit, ExitCode } from '../output'

const STATUS_LABEL = { 'in-progress': 'In progress', blocked: 'Blocked', 'in-review': 'In review', todo: 'Todo' } as const

// Same structure as the /pickup skill's briefing, as markdown so it reads well in a terminal and in a transcript.
export function renderPickup(p: Pickup) {
  const out: string[] = [`## Session Briefing: ${p.project.slug}`, '', `### Open Tasks (${p.openTaskCount})`]
  for (const status of Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]) {
    const tasks = p.tasks[status]
    if (!tasks.length) continue
    out.push('', `**${STATUS_LABEL[status]}** (${tasks.length})`)
    for (const t of tasks) out.push(`- \`${t.slug}\`: ${t.title} [${t.priority}]${t.summary ? `: ${t.summary}` : ''}`)
  }
  if (!p.openTaskCount) out.push('', 'No open tasks.')

  out.push('', `### Docs (${p.docCount})`)
  for (const d of p.docs) out.push(`- ${d.highPriority ? '⭐ ' : ''}${d.title} (\`${d.slug}\`)${d.summary ? `: ${d.summary}` : ''}`)
  if (p.sessionNotesCount) out.push(`- ${p.sessionNotesCount} session-notes doc${p.sessionNotesCount === 1 ? '' : 's'} (latest shown below)`)
  if (p.docs.some(d => d.highPriority)) out.push('', '⭐ = tagged architecture, decisions, or context: read first.')

  out.push('', '### Last Session Notes')
  out.push(...(p.lastSessionNotes ? [`_${p.lastSessionNotes.title}_ (\`${p.lastSessionNotes.slug}\`)`, '', p.lastSessionNotes.body] : ['No previous session notes found.']))

  out.push('', '### Suggested Focus', '_Picked by rule: in-progress first, then todo by priority and board order, then in-review._')
  p.suggestedFocus.forEach((t, i) => out.push(`${i + 1}. \`${t.slug}\`: ${t.title} [${t.status}, ${t.priority}]`))
  if (!p.suggestedFocus.length) out.push('Nothing open.')
  return out.join('\n')
}

export default defineCommand({
  meta: { name: 'pickup', description: 'Session briefing for a project: open tasks, docs, and the latest session notes' },
  args: {
    ...globalArgs,
    ref: { type: 'positional', description: 'Project slug or unique fragment (default: current repo\'s project)', required: false },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const slug = args.ref ? ctx.core.resolveProject(args.ref).slug : ctx.inferProject()?.slug
    if (!slug) throw new CliError('no project: name one, or run inside a repo registered in mdpm (see `mdpm config show`)', ExitCode.usage)
    const pickup = buildPickup(ctx.core, slug)
    emit(ctx.json, pickup, () => renderPickup(pickup))
  },
})
