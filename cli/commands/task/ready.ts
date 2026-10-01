import { defineCommand } from 'citty'
import { blockedTasks, readyTasks, taskId } from '../../../lib/core'
import { createContext, globalArgs } from '../../context'
import { emit, table } from '../../output'
import { loadGraph, projectArgs, scopeProject } from './shared'

export default defineCommand({
  meta: { name: 'ready', description: 'Todo tasks whose dependencies are all done (--blocked shows what is waiting on what)' },
  args: {
    ...globalArgs,
    ...projectArgs,
    all: { type: 'boolean', description: 'Across all projects', default: false },
    blocked: { type: 'boolean', description: 'Instead list todo/in-progress tasks that are still waiting, with their blockers', default: false },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const project = scopeProject(ctx, args)
    const graph = loadGraph(ctx)
    const inScope = <T extends { project: string }>(t: T) => !project || t.project === project
    const shown = (id: string) => project && id.startsWith(`${project}/`) ? id.slice(project.length + 1) : id

    if (args.blocked) {
      const blocked = blockedTasks(graph).filter(b => inScope(b.task))
      emit(ctx.json, blocked.map(b => ({ ...b.task, blockers: b.blockers })), () => blocked.length
        ? `${table(blocked.map(b => [b.task.status, b.task.priority, shown(taskId(b.task)), b.blockers.map(x => x.reason === 'missing' ? `${shown(x.id)} (missing)` : `${shown(x.id)} [${x.status}]`).join(', ')]), ['STATUS', 'PRIORITY', 'TASK', 'WAITING ON'])}\n${ctx.style.dim(`${blocked.length} blocked`)}`
        : ctx.style.dim('nothing is blocked'))
      return
    }
    const ready = readyTasks(graph).filter(inScope)
    emit(ctx.json, ready, () => ready.length
      ? `${table(ready.map(t => [t.priority, shown(taskId(t)), t.title]), ['PRIORITY', 'TASK', 'TITLE'])}\n${ctx.style.dim(`${ready.length} ready`)}`
      : ctx.style.dim('no tasks are ready'))
  },
})
