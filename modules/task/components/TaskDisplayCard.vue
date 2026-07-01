<script setup lang="ts">
const props = defineProps<{
  task: Task
  hasBlockingDeps?: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  click: []
  'mark-done': []
  reopen: []
  delete: []
}>()

const dueInfo = computed(() => props.task.due ? formatDueDate(props.task.due) : null)
const tags = computed(() => props.task.tags ?? [])
const assignees = computed(() => props.task.assignees ?? [])
const depCount = computed(() => props.task.dependencies?.length ?? 0)
const priority = computed(() => PRIORITY_MAP[props.task.priority])
const isDone = computed(() => props.task.status === 'done')
const isAiInProgress = computed(() =>
  props.task.status === 'in-progress' && assignees.value.includes('Claude'),
)
const completedLabel = computed(() => {
  if (!props.task.completedAt) return null
  return new Date(props.task.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
})

const githubRepo = computed(() => props.task.githubRepo)
const githubIssues = computed(() => props.task.githubIssues ?? [])
const githubPRs = computed(() => props.task.githubPRs ?? [])
const hasGithubRefs = computed(() => githubIssues.value.length > 0 || githubPRs.value.length > 0)

function issueUrl(n: number) {
  return githubRepo.value ? `https://github.com/${githubRepo.value}/issues/${n}` : null
}
function prUrl(n: number) {
  return githubRepo.value ? `https://github.com/${githubRepo.value}/pull/${n}` : null
}
</script>

<template>
  <UCard
    :ui="{ root: 'group cursor-pointer select-none transition-all hover:shadow-sm shrink-0', body: 'px-2.5! py-2! flex flex-col gap-1.5' }"
    :class="loading ? 'opacity-60' : ''"
    @click="emit('click')"
  >
    <!-- Title + actions -->
    <div class="flex items-start gap-1.5">
      <span class="flex-1 text-sm font-medium leading-snug">{{ task.title }}</span>
      <UButton
        icon="i-lucide-trash-2"
        color="error"
        variant="ghost"
        size="xs"
        class="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0 -mt-0.5"
        @click.stop="emit('delete')"
      />
      <UTooltip v-if="isAiInProgress" text="Claude is working on this…">
        <UIcon name="i-lucide-loader-2" class="size-4 shrink-0 text-info animate-spin" />
      </UTooltip>
      <UButton
        v-else-if="task.status !== 'done'"
        icon="i-lucide-circle"
        color="neutral"
        variant="ghost"
        size="xs"
        class="opacity-30 group-hover:opacity-100 group-hover:text-success transition-opacity shrink-0 -mt-0.5 -mr-1"
        aria-label="Mark done"
        @click.stop="emit('mark-done')"
      />
      <UButton
        v-else
        icon="i-lucide-check-circle-2"
        color="success"
        variant="ghost"
        size="xs"
        class="opacity-60 group-hover:opacity-100 transition-opacity shrink-0 -mt-0.5 -mr-1"
        aria-label="Re-open task"
        @click.stop="emit('reopen')"
      />
    </div>

    <!-- Done: completedAt + assignees only -->
    <template v-if="isDone">
      <div class="flex items-center justify-between gap-1.5">
        <span v-if="completedLabel" class="text-xs text-muted">Completed {{ completedLabel }}</span>
        <div v-if="assignees.length" class="flex -space-x-1 ml-auto">
          <UTooltip v-for="a in assignees.slice(0, 3)" :key="a" :text="a">
            <UAvatar :alt="a" size="2xs" />
          </UTooltip>
          <UAvatar v-if="assignees.length > 3" :alt="`+${assignees.length - 3}`" size="2xs" />
        </div>
      </div>
    </template>

    <!-- Active: priority + due + tags + deps + assignees -->
    <template v-else>
      <div class="flex items-center gap-1.5 flex-wrap">
        <span
          v-if="dueInfo"
          class="text-xs tabular-nums"
          :class="dueInfo.isOverdue ? 'text-error font-medium' : dueInfo.isDueSoon ? 'text-warning' : 'text-muted'"
        >{{ dueInfo.label }}</span>
        <UBadge
          v-if="priority"
          :label="priority.label"
          :color="priority.color"
          :icon="priority.icon"
          variant="subtle"
          size="xs"
        />
        <UBadge
          v-for="tag in tags.slice(0, 2)"
          :key="tag"
          :label="tag"
          color="neutral"
          variant="outline"
          size="xs"
        />
      </div>
      <div v-if="depCount || assignees.length" class="flex items-center">
        <span
          v-if="depCount"
          class="flex items-center gap-0.5 text-xs"
          :class="hasBlockingDeps ? 'text-error' : 'text-muted'"
          :title="hasBlockingDeps ? 'Unresolved dependencies' : 'All dependencies resolved'"
        >
          <UIcon name="i-lucide-git-branch" class="size-3.5 shrink-0" />
          {{ depCount }}
        </span>
        <div v-if="assignees.length" class="flex -space-x-1 ml-auto">
          <UTooltip v-for="a in assignees.slice(0, 3)" :key="a" :text="a">
            <UAvatar :alt="a" size="2xs" />
          </UTooltip>
          <UAvatar v-if="assignees.length > 3" :alt="`+${assignees.length - 3}`" size="2xs" />
        </div>
      </div>
      <div v-if="hasGithubRefs" class="flex items-center gap-1 flex-wrap">
        <template v-for="n in githubIssues.slice(0, 2)" :key="`i-${n}`">
          <a
            v-if="issueUrl(n)"
            :href="issueUrl(n)!"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-0.5 text-xs text-muted hover:text-primary transition-colors"
            @click.stop
          >
            <UIcon name="i-lucide-circle-dot" class="size-3 shrink-0" />
            #{{ n }}
          </a>
          <span v-else class="flex items-center gap-0.5 text-xs text-muted">
            <UIcon name="i-lucide-circle-dot" class="size-3 shrink-0" />
            #{{ n }}
          </span>
        </template>
        <template v-for="n in githubPRs.slice(0, 2)" :key="`p-${n}`">
          <a
            v-if="prUrl(n)"
            :href="prUrl(n)!"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-0.5 text-xs text-muted hover:text-primary transition-colors"
            @click.stop
          >
            <UIcon name="i-lucide-git-pull-request" class="size-3 shrink-0" />
            #{{ n }}
          </a>
          <span v-else class="flex items-center gap-0.5 text-xs text-muted">
            <UIcon name="i-lucide-git-pull-request" class="size-3 shrink-0" />
            #{{ n }}
          </span>
        </template>
      </div>
    </template>
  </UCard>
</template>
