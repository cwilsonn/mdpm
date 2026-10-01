import { defineCommand } from 'citty'
import { watchContent, type WatchEvent } from '../../lib/core'
import { createContext, globalArgs } from '../context'

const KIND_COLOR = { task: 'cyan', doc: 'yellow', project: 'green' } as const

const show = (v: unknown) => Array.isArray(v) ? (v.length ? v.join(', ') : '(none)') : v === null || v === undefined || v === '' ? '(none)' : String(v)

export default defineCommand({
  meta: { name: 'watch', description: 'Follow changes to projects, tasks, and docs as they happen, whoever makes them (Ctrl-C to stop)' },
  args: {
    ...globalArgs,
    project: { type: 'string', description: 'Only this project (default: the current repo\'s project, else everything)' },
    all: { type: 'boolean', description: 'Everything: every project plus standalone docs', default: false },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const project = args.project ? ctx.core.getProject(args.project).slug : args.all ? undefined : ctx.inferProject()?.slug
    const s = ctx.style

    const describe = (e: WatchEvent) => {
      const where = e.project ? `${e.project}/${e.slug}` : e.slug
      if (e.kind === 'task' && e.action === 'note') return `${where}  note${e.note?.author ? ` by ${e.note.author}` : ''}: ${e.note?.text.split('\n')[0]}`
      if (e.action === 'updated') return `${where}  ${(e.changes ?? []).map(c => c.from === undefined && c.to === undefined ? c.field : `${c.field}: ${show(c.from)} → ${show(c.to)}`).join('; ')}`
      return `${where}  ${e.action}: ${e.title}`
    }
    const print = (e: WatchEvent) => {
      if (ctx.json) { console.log(JSON.stringify(e)); return }
      const time = new Date(e.at).toTimeString().slice(0, 8)
      console.log(`${s.dim(time)}  ${s[KIND_COLOR[e.kind]](e.kind.padEnd(7))} ${describe(e)}`)
    }

    const watcher = watchContent(ctx.core, {
      project,
      onEvent: print,
      onError: err => console.error(`${s.yellow('warning:')} ${err.message}`),
    })
    console.error(s.dim(`watching ${ctx.core.config.contentPath}${project ? ` (project ${project})` : ' (all projects)'}; Ctrl-C to stop`))

    // Run until interrupted; closing the watcher lets the process exit on its own.
    await new Promise<void>((resolve) => {
      for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { watcher.close(); resolve() })
    })
  },
})
