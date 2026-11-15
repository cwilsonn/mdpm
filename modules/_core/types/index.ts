/** An option in a filter dropdown (`AppFilterMenu`): status, priority, assignee, project. */
export interface FilterItem {
  label: string
  value: string
  icon?: string
  color?: string
  avatar?: { alt: string }
}
