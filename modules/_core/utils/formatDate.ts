export interface DueDateInfo {
  label: string
  isOverdue: boolean
  isDueSoon: boolean
}

export function formatDueDate(dateStr: string | null | undefined): DueDateInfo | null {
  if (!dateStr) return null
  const [y, m, d] = dateStr.split('-').map(Number)
  const due = new Date(y, m - 1, d)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000)

  if (diffDays < 0) {
    const abs = Math.abs(diffDays)
    return { label: `${abs}d overdue`, isOverdue: true, isDueSoon: false }
  }
  if (diffDays === 0) return { label: 'Today', isOverdue: false, isDueSoon: true }
  if (diffDays === 1) return { label: 'Tomorrow', isOverdue: false, isDueSoon: true }
  if (diffDays <= 7) return { label: `in ${diffDays}d`, isOverdue: false, isDueSoon: true }
  return {
    label: due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    isOverdue: false,
    isDueSoon: false,
  }
}
