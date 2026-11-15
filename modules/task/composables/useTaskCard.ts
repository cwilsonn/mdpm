import type { MaybeRefOrGetter } from 'vue'

// Derived view state shared by the two task presentations, TaskDisplayCard
// (kanban card) and TaskDisplayLine (list row). Both previously re-declared
// this identical block of computeds; they now differ only
// in layout/template.
export function useTaskCard(task: MaybeRefOrGetter<Task>) {
  const t = computed(() => toValue(task))

  const dueInfo = computed(() => t.value.due ? formatDueDate(t.value.due) : null)
  const tags = computed(() => t.value.tags ?? [])
  const depCount = computed(() => t.value.dependencies?.length ?? 0)
  const status = computed(() => statusMeta(t.value.status))
  const priority = computed(() => priorityMeta(t.value.priority))
  const isDone = computed(() => t.value.status === 'done')
  const completedLabel = computed(() => {
    if (!t.value.completedAt) return null
    return new Date(t.value.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  })

  return {
    dueInfo, tags, depCount, status, priority,
    isDone, completedLabel,
  }
}
