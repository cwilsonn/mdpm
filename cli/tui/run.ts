import { ServerUnreachableError, resolveAuthor, watchContent } from '../../lib/core'
import type { Context } from '../context'
import { CliError, ExitCode } from '../output'
import { parseKeys } from './keys'
import { renderScreen } from './render'
import { initialState, update, withMessage, withProjects, withTasks, type Effect, type TuiState, type TuiTask } from './state'

const ESC = '\x1b['

export async function runTui(ctx: Context, opts: { project?: string }): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError('mdpm tui needs an interactive terminal (stdin and stdout must both be terminals)', ExitCode.usage)
  }
  const { core } = ctx

  const loadTasks = (project: string): TuiTask[] => core.listTasks({ project }).map(t => ({
    project: t.project, slug: t.slug, title: t.title, status: t.status, priority: t.priority, tags: t.tags,
    assignees: t.assignees, due: t.due, dependencies: t.dependencies, body: t.body, order: t.order,
  }))
  const projectList = () => core.listProjects().map(p => ({ slug: p.slug, title: p.title }))
  const open = (slug: string): TuiState => initialState(slug, core.getProject(slug).title, loadTasks(slug))

  let state: TuiState
  if (opts.project) state = open(opts.project)
  else {
    const projects = projectList()
    if (projects.length === 1) state = open(projects[0]!.slug)
    else state = { ...initialState('', '', []), mode: 'picker', picker: { projects, index: 0 } }
  }

  const size = () => ({ columns: process.stdout.columns || 80, rows: process.stdout.rows || 24 })
  const render = () => {
    const lines = renderScreen(state, size())
    process.stdout.write(`${ESC}H${lines.map(l => `${l}${ESC}K`).join('\r\n')}${ESC}J`)
  }

  let watcher: { close: () => void } | undefined
  let reloadTimer: NodeJS.Timeout | undefined
  const watch = () => {
    watcher?.close()
    watcher = undefined
    if (!state.project) return
    try {
      watcher = watchContent(core, {
        project: state.project,
        onEvent: () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(reload, 100) },
        onError: () => {},
      })
    }
    catch {}
  }
  const reload = () => {
    if (!state.project) return
    try { state = withTasks(state, loadTasks(state.project)) }
    catch (err) { state = withMessage(state, (err as Error).message, true) }
    render()
  }

  const describe = (err: unknown) => err instanceof ServerUnreachableError ? 'the server is not running: start it with `mdpm start` (or run mdpm tui --auto-start)' : (err as Error).message

  let done: () => void
  const finished = new Promise<void>((resolve) => { done = resolve })

  const handle = async (effect: Effect) => {
    try {
      switch (effect.type) {
        case 'quit': done(); return
        case 'reload': reload(); return
        case 'projects': state = withProjects(state, projectList()); render(); return
        case 'switch': state = open(effect.project); watch(); render(); return
        case 'move':
          await core.updateTask(effect.task.project, effect.task.slug, { status: effect.status })
          reload(); state = withMessage(state, `moved "${effect.task.title}" to ${effect.status}`); break
        case 'priority':
          await core.updateTask(effect.task.project, effect.task.slug, { priority: effect.priority })
          reload(); state = withMessage(state, `"${effect.task.title}" is now ${effect.priority}`); break
        case 'note':
          await core.appendTaskNote(effect.task.project, effect.task.slug, effect.text, resolveAuthor())
          reload(); state = withMessage(state, `note added to "${effect.task.title}"`); break
        case 'add':
          await core.createTask(state.project, { title: effect.title, status: effect.status })
          reload(); state = withMessage(state, `added "${effect.title}" to ${effect.status}`); break
      }
    }
    catch (err) {
      state = withMessage(state, describe(err), true)
    }
    render()
  }

  // Effects run one at a time, in the order the keys were pressed.
  let queue: Promise<void> = Promise.resolve()
  const onData = (chunk: string) => {
    for (const key of parseKeys(chunk)) {
      const [next, effect] = update(state, key)
      state = next
      if (effect) queue = queue.then(() => handle(effect))
    }
    render()
  }

  const restore = () => {
    process.stdout.write(`${ESC}?25h${ESC}?1049l`)
    if (process.stdin.isTTY) process.stdin.setRawMode(false)
  }
  process.stdout.write(`${ESC}?1049h${ESC}?25l`)
  process.stdin.setRawMode(true)
  process.stdin.setEncoding('utf8')
  process.stdin.resume()
  process.stdin.on('data', onData)
  process.stdout.on('resize', render)
  process.once('exit', restore)
  for (const signal of ['SIGTERM', 'SIGHUP'] as const) process.once(signal, done!)
  watch()
  render()

  await finished
  clearTimeout(reloadTimer)
  watcher?.close()
  process.stdin.off('data', onData)
  process.stdout.off('resize', render)
  process.stdin.pause()
  restore()
  process.off('exit', restore)
}
