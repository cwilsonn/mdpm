// Canonical task types — single source shared across task components and
// the project/inbox pages that render them. Replaces the per-component
// `interface Task` copies that each carried a `[key: string]: unknown`
// escape hatch (which forced `as any` at every extra-field access).

/** A task as returned by the content/API layer. Superset — list/card views use a subset. */
export interface Task {
  path: string
  slug?: string
  project?: string
  title: string
  status: string
  priority: string
  tags?: string[]
  assignees?: string[]
  dependencies?: string[]
  due?: string
  completedAt?: string
  createdAt?: string
  updatedAt?: string
  order?: number
  githubRepo?: string
  githubIssues?: number[]
  githubPRs?: number[]
}

/** Back-compat alias — display components historically referenced `TaskCardData`. */
export type TaskCardData = Task

/** A status column descriptor (shape of a `STATUS_CONFIG` entry, mutable). */
export interface StatusCfg {
  id: string
  label: string
  icon: string
  color: string
}
