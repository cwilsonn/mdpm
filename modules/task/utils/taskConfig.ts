// Task status
export const STATUS_CONFIG = [
  { id: 'todo', label: 'Todo', icon: 'i-lucide-circle', color: 'neutral' },
  { id: 'in-progress', label: 'In Progress', icon: 'i-lucide-circle-dot', color: 'info' },
  { id: 'in-review', label: 'In Review', icon: 'i-lucide-eye', color: 'warning' },
  { id: 'blocked', label: 'Blocked', icon: 'i-lucide-circle-x', color: 'error' },
  { id: 'on-hold', label: 'On Hold', icon: 'i-lucide-circle-pause', color: 'secondary' },
  { id: 'done', label: 'Done', icon: 'i-lucide-circle-check', color: 'success' },
] as const

export type StatusId = typeof STATUS_CONFIG[number]['id']

export const STATUS_MAP = Object.fromEntries(
  STATUS_CONFIG.map(s => [s.id, s]),
) as Record<string, typeof STATUS_CONFIG[number]>

export const STATUS_SELECT_ITEMS = STATUS_CONFIG.map(s => ({
  label: s.label,
  value: s.id,
  icon: s.icon,
  color: s.color,
}))

// Task priority
export const PRIORITY_CONFIG = [
  { id: 'low', label: 'Low', icon: 'i-lucide-arrow-down', color: 'neutral' },
  { id: 'medium', label: 'Medium', icon: 'i-lucide-arrow-right', color: 'info' },
  { id: 'high', label: 'High', icon: 'i-lucide-arrow-up', color: 'warning' },
  { id: 'urgent', label: 'Urgent', icon: 'i-lucide-chevrons-up', color: 'error' },
] as const

export type PriorityId = typeof PRIORITY_CONFIG[number]['id']

export const PRIORITY_MAP = Object.fromEntries(
  PRIORITY_CONFIG.map(p => [p.id, p]),
) as Record<string, typeof PRIORITY_CONFIG[number]>

export const PRIORITY_SELECT_ITEMS = PRIORITY_CONFIG.map(p => ({
  label: p.label,
  value: p.id,
  icon: p.icon,
  color: p.color,
}))

// Project status
export const PROJECT_STATUS_CONFIG = [
  { id: 'active', label: 'Active', color: 'success' },
  { id: 'on-hold', label: 'On Hold', color: 'warning' },
  { id: 'archived', label: 'Archived', color: 'neutral' },
] as const

export const PROJECT_STATUS_MAP = Object.fromEntries(
  PROJECT_STATUS_CONFIG.map(s => [s.id, s]),
) as Record<string, typeof PROJECT_STATUS_CONFIG[number]>

export const PROJECT_STATUS_SELECT_ITEMS = PROJECT_STATUS_CONFIG.map(s => ({
  label: s.label,
  value: s.id,
  chip: { color: s.color },
}))

export function slugFromPath(path: string): string {
  return path.split('/').at(-1) ?? ''
}

export function getAssigneeNames(tasks: Array<{ assignees?: string[] }>): string[] {
  const set = new Set<string>()
  for (const t of tasks) {
    for (const a of t.assignees ?? []) set.add(a)
  }
  return [...set].sort()
}
