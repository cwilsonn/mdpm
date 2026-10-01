import { defineCommand } from 'citty'
import { blockersOf, taskId, tree, type Graph, type TreeNode } from '../../../lib/core'
import { createContext, globalArgs } from '../../context'
import { CliError, emit, ExitCode } from '../../output'
import { loadGraph, projectArgs, resolveRef, scopeProject } from './shared'

const FORMATS = ['text', 'mermaid', 'dot'] as const

function renderTree(node: TreeNode, prefix = '', last = true, root = true, label = (n: TreeNode) => n.id): string[] {
  const line = root ? label(node) : `${prefix}${last ? '└─ ' : '├─ '}${label(node)}`
  const childPrefix = root ? '' : `${prefix}${last ? '   ' : '│  '}`
  return [line, ...node.children.flatMap((c, i) => renderTree(c, childPrefix, i === node.children.length - 1, false, label))]
}

const nodeLabel = (n: TreeNode) => `${n.id}${n.task ? ` [${n.task.status}]` : ' (missing)'}${n.cycle ? ' (cycle)' : ''}`

function edges(graph: Graph, ids: Set<string>) {
  return [...graph.dependsOn.entries()].flatMap(([id, deps]) => deps.filter(d => ids.has(d) && ids.has(id)).map(d => ({ dependency: d, task: id })))
}

function mermaid(graph: Graph, ids: string[]) {
  const key = new Map(ids.map((id, i) => [id, `n${i}`]))
  const lines = ['flowchart LR']
  for (const id of ids) {
    const t = graph.tasks.get(id)
    lines.push(`  ${key.get(id)}["${(t?.slug ?? id).replace(/"/g, "'")}<br/>${t?.status ?? 'missing'}"]`)
  }
  for (const e of edges(graph, new Set(ids))) lines.push(`  ${key.get(e.dependency)} --> ${key.get(e.task)}`)
  return lines.join('\n')
}

function dot(graph: Graph, ids: string[]) {
  const lines = ['digraph tasks {', '  rankdir=LR;', '  node [shape=box];']
  for (const id of ids) lines.push(`  "${id}" [label="${(graph.tasks.get(id)?.slug ?? id).replace(/"/g, "'")}\\n${graph.tasks.get(id)?.status ?? 'missing'}"];`)
  for (const e of edges(graph, new Set(ids))) lines.push(`  "${e.dependency}" -> "${e.task}";`)
  lines.push('}')
  return lines.join('\n')
}

export default defineCommand({
  meta: { name: 'graph', description: 'Task dependencies: a tree for one task, or the whole graph (text, mermaid, or dot)' },
  args: {
    ...globalArgs,
    ...projectArgs,
    all: { type: 'boolean', description: 'Across all projects', default: false },
    format: { type: 'string', description: `${FORMATS.join(' | ')} (default: text)`, default: 'text' },
    ref: { type: 'positional', description: 'A task: show what it waits on and what waits on it', required: false },
  },
  async run({ args }) {
    const ctx = createContext(args)
    if (!FORMATS.includes(args.format as typeof FORMATS[number])) throw new CliError(`--format: '${args.format}' is not one of ${FORMATS.join(', ')}`, ExitCode.usage)
    const graph = loadGraph(ctx)

    if (args.ref) {
      const task = resolveRef(ctx, args.ref, args)
      const id = taskId(task)
      const up = tree(graph, id, 'up')
      const down = tree(graph, id, 'down')
      emit(ctx.json, { task: id, waitsOn: up, unblocks: down, blockers: blockersOf(graph, id) }, () => [
        ctx.style.bold(`${id} [${task.status}] ${task.title}`),
        '',
        up.children.length ? `Waits on:\n${renderTree(up, '', true, true, nodeLabel).slice(1).join('\n')}` : ctx.style.dim('Waits on nothing.'),
        '',
        down.children.length ? `Unblocks:\n${renderTree(down, '', true, true, nodeLabel).slice(1).join('\n')}` : ctx.style.dim('Nothing waits on it.'),
      ].join('\n'))
      return
    }

    const project = scopeProject(ctx, args)
    // Only tasks that take part in a dependency are interesting; leave out archived ones that nothing refers to.
    const involved = [...graph.tasks.keys()].filter(id =>
      (!project || id.startsWith(`${project}/`))
      && ((graph.dependsOn.get(id)?.length ?? 0) > 0 || (graph.dependents.get(id)?.length ?? 0) > 0))
    const ids = [...new Set([...involved, ...involved.flatMap(id => graph.dependsOn.get(id) ?? [])])].sort()

    if (args.format === 'mermaid') { console.log(mermaid(graph, ids)); return }
    if (args.format === 'dot') { console.log(dot(graph, ids)); return }

    const missing = graph.missing.filter(m => ids.includes(m.task))
    const cycles = graph.cycles.filter(c => c.some(id => ids.includes(id)))
    emit(ctx.json, { tasks: ids, edges: edges(graph, new Set(ids)), missing, cycles }, () => {
      if (!ids.length) return ctx.style.dim('no task dependencies')
      const status = (id: string) => graph.tasks.get(id)?.status ?? 'missing'
      const lines = ids.filter(id => (graph.dependsOn.get(id)?.length ?? 0) > 0).map(id => `${id} [${status(id)}]\n   waits on ${graph.dependsOn.get(id)!.map(d => `${d} [${status(d)}]`).join(', ')}`)
      const roots = ids.filter(id => (graph.dependsOn.get(id)?.length ?? 0) === 0)
      return [
        ...lines,
        ...(roots.length ? ['', ctx.style.dim(`no dependencies of their own: ${roots.join(', ')}`)] : []),
        ...(missing.length ? ['', ctx.style.yellow(`missing: ${missing.map(m => `${m.task} → ${m.dependency}`).join(', ')}`)] : []),
        ...(cycles.length ? ['', ctx.style.red(`cycles: ${cycles.map(c => c.join(' ↔ ')).join('; ')}`)] : []),
      ].join('\n')
    })
  },
})
