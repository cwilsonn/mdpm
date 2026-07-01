import { STATUS_MAP, PRIORITY_MAP } from '../utils/taskConfig'

export function useTaskMeta() {
  function statusColor(status: string) {
    return STATUS_MAP[status]?.color ?? 'neutral'
  }

  function statusIcon(status: string) {
    return STATUS_MAP[status]?.icon ?? 'i-lucide-circle'
  }

  function priorityColor(priority: string) {
    return PRIORITY_MAP[priority]?.color ?? 'neutral'
  }

  function priorityIcon(priority: string) {
    return PRIORITY_MAP[priority]?.icon ?? 'i-lucide-arrow-right'
  }

  return { statusColor, statusIcon, priorityColor, priorityIcon }
}
