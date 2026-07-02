import type { MaybeRefOrGetter } from 'vue'

// Derived view state shared by the two task presentations, TaskDisplayCard
// (kanban card) and TaskDisplayLine (list row). Both previously re-declared
// this identical block of computeds + GitHub URL helpers; they now differ only
// in layout/template.
export function useTaskCard(task: MaybeRefOrGetter<Task>) {
  const t = computed(() => toValue(task))

  const dueInfo = computed(() => t.value.due ? formatDueDate(t.value.due) : null)
  const tags = computed(() => t.value.tags ?? [])
  const assignees = computed(() => t.value.assignees ?? [])
  const depCount = computed(() => t.value.dependencies?.length ?? 0)
  // Fall back to a neutral descriptor for statuses/priorities not in the config
  // (legacy or hand-edited frontmatter) so templates never deref undefined.
  // Fallback color/icon match useTaskMeta's guarded helpers.
  const status = computed(() =>
    STATUS_MAP[t.value.status] ?? { id: t.value.status, label: t.value.status, icon: 'i-lucide-circle', color: 'neutral' as const },
  )
  const priority = computed(() =>
    PRIORITY_MAP[t.value.priority] ?? { id: t.value.priority, label: t.value.priority, icon: 'i-lucide-arrow-right', color: 'neutral' as const },
  )
  const isDone = computed(() => t.value.status === 'done')
  const isAiInProgress = computed(() =>
    t.value.status === 'in-progress' && assignees.value.includes('Claude'),
  )
  const completedLabel = computed(() => {
    if (!t.value.completedAt) return null
    return new Date(t.value.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  })

  const githubRepo = computed(() => t.value.githubRepo)
  const githubIssues = computed(() => t.value.githubIssues ?? [])
  const githubPRs = computed(() => t.value.githubPRs ?? [])
  const hasGithubRefs = computed(() => githubIssues.value.length > 0 || githubPRs.value.length > 0)

  function issueUrl(n: number) {
    return githubRepo.value ? `https://github.com/${githubRepo.value}/issues/${n}` : null
  }
  function prUrl(n: number) {
    return githubRepo.value ? `https://github.com/${githubRepo.value}/pull/${n}` : null
  }

  return {
    dueInfo, tags, assignees, depCount, status, priority,
    isDone, isAiInProgress, completedLabel,
    githubRepo, githubIssues, githubPRs, hasGithubRefs, issueUrl, prUrl,
  }
}
