// Task dependencies. A task lists the slugs of tasks it waits on in its `dependencies` frontmatter, either bare
// (same project) or `project/slug`. A dependency is resolved when that task is done or archived; a dependency
// that names a task which no longer exists is reported and keeps its dependent blocked, so it gets noticed.

export interface DepTask {
  project: string
  slug: string
  title: string
  status: string
  priority: string
  order: number
  dependencies: string[]
  archivedAt: string | null
}

export const taskId = (t: { project: string; slug: string }) => `${t.project}/${t.slug}`
const dependencyId = (project: string, dep: string) => dep.includes('/') ? dep : `${project}/${dep}`
export const isResolved = (t: DepTask) => t.status === 'done' || !!t.archivedAt

export interface Graph {
  tasks: Map<string, DepTask>
  /** id -> the ids it depends on (may name tasks that do not exist) */
  dependsOn: Map<string, string[]>
  /** id -> the ids that depend on it */
  dependents: Map<string, string[]>
  missing: { task: string; dependency: string }[]
  cycles: string[][]
}

export function buildGraph(tasks: DepTask[]): Graph {
  const byId = new Map(tasks.map(t => [taskId(t), t]))
  const dependsOn = new Map<string, string[]>()
  const dependents = new Map<string, string[]>()
  const missing: Graph['missing'] = []
  for (const t of tasks) {
    const id = taskId(t)
    const deps = [...new Set(t.dependencies.map(d => dependencyId(t.project, d)))]
    dependsOn.set(id, deps)
    for (const dep of deps) {
      if (!byId.has(dep)) missing.push({ task: id, dependency: dep })
      dependents.set(dep, [...dependents.get(dep) ?? [], id])
    }
  }
  return { tasks: byId, dependsOn, dependents, missing, cycles: findCycles(byId, dependsOn) }
}

// Strongly connected components with more than one task, or a task that depends on itself (Tarjan).
function findCycles(tasks: Map<string, DepTask>, dependsOn: Map<string, string[]>): string[][] {
  let counter = 0
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const cycles: string[][] = []
  const visit = (id: string) => {
    index.set(id, counter)
    low.set(id, counter++)
    stack.push(id)
    onStack.add(id)
    for (const dep of dependsOn.get(id) ?? []) {
      if (!tasks.has(dep)) continue
      if (!index.has(dep)) {
        visit(dep)
        low.set(id, Math.min(low.get(id)!, low.get(dep)!))
      }
      else if (onStack.has(dep)) low.set(id, Math.min(low.get(id)!, index.get(dep)!))
    }
    if (low.get(id) === index.get(id)) {
      const component: string[] = []
      let member: string
      do {
        member = stack.pop()!
        onStack.delete(member)
        component.push(member)
      } while (member !== id)
      if (component.length > 1 || (dependsOn.get(id) ?? []).includes(id)) cycles.push(component.sort())
    }
  }
  for (const id of tasks.keys()) if (!index.has(id)) visit(id)
  return cycles.sort((a, b) => a[0]!.localeCompare(b[0]!))
}

export interface Blocker {
  id: string
  /** `open`: exists but is not done or archived; `missing`: names a task that does not exist */
  reason: 'open' | 'missing'
  status?: string
}

export function blockersOf(graph: Graph, id: string): Blocker[] {
  return (graph.dependsOn.get(id) ?? []).flatMap((dep): Blocker[] => {
    const t = graph.tasks.get(dep)
    if (!t) return [{ id: dep, reason: 'missing' }]
    return isResolved(t) ? [] : [{ id: dep, reason: 'open', status: t.status }]
  })
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
export const byPriority = (a: DepTask, b: DepTask) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || a.order - b.order

/** Todo tasks that are not archived and have every dependency resolved (including tasks with none). */
export function readyTasks(graph: Graph): DepTask[] {
  return [...graph.tasks.values()]
    .filter(t => t.status === 'todo' && !t.archivedAt && blockersOf(graph, taskId(t)).length === 0)
    .sort(byPriority)
}

/** Todo or in-progress tasks that are still waiting on something, with what they wait on. */
export function blockedTasks(graph: Graph): { task: DepTask; blockers: Blocker[] }[] {
  return [...graph.tasks.values()]
    .filter(t => (t.status === 'todo' || t.status === 'in-progress') && !t.archivedAt)
    .map(task => ({ task, blockers: blockersOf(graph, taskId(task)) }))
    .filter(b => b.blockers.length > 0)
    .sort((a, b) => byPriority(a.task, b.task))
}

export interface TreeNode {
  id: string
  task?: DepTask
  /** this id already appears on the path from the root, so the walk stops here */
  cycle?: boolean
  children: TreeNode[]
}

/** The tree of what `id` waits on (`up`) or what waits on it (`down`), cycle-safe. */
export function tree(graph: Graph, id: string, direction: 'up' | 'down', path: string[] = []): TreeNode {
  const node: TreeNode = { id, task: graph.tasks.get(id), children: [] }
  if (path.includes(id)) return { ...node, cycle: true }
  const next = (direction === 'up' ? graph.dependsOn : graph.dependents).get(id) ?? []
  node.children = next.map(child => tree(graph, child, direction, [...path, id]))
  return node
}

/** Would making `taskIdValue` depend on `newDeps` create a cycle? Returns the offending path, if any. */
export function wouldCreateCycle(graph: Graph, taskIdValue: string, newDeps: string[]): string[] | undefined {
  for (const dep of newDeps) {
    if (dep === taskIdValue) return [taskIdValue, taskIdValue]
    // Walk from the new dependency along its own dependencies, looking for the task being edited.
    const seen = new Set<string>()
    const walk = (current: string, trail: string[]): string[] | undefined => {
      if (current === taskIdValue) return [taskIdValue, ...trail]
      if (seen.has(current)) return undefined
      seen.add(current)
      for (const next of graph.dependsOn.get(current) ?? []) {
        const found = walk(next, [...trail, next])
        if (found) return found
      }
      return undefined
    }
    const found = walk(dep, [dep])
    if (found) return found
  }
  return undefined
}
