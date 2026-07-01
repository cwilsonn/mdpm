// Project display config — canonical status metadata for the project domain.
// (Previously lived in the task module's taskConfig, which was the wrong home.)
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
