<script setup lang="ts">
const props = defineProps<{
  task: Task
  showStatus?: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  click: []
  'mark-done': []
  reopen: []
  delete: []
}>()

const dueInfo = computed(() => props.task.due ? formatDueDate(props.task.due) : null)
const assignees = computed(() => props.task.assignees ?? [])
const depCount = computed(() => props.task.dependencies?.length ?? 0)
const status = computed(() => STATUS_MAP[props.task.status])
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

function issueUrl(n: number) {
  return githubRepo.value ? `https://github.com/${githubRepo.value}/issues/${n}` : null
}
function prUrl(n: number) {
  return githubRepo.value ? `https://github.com/${githubRepo.value}/pull/${n}` : null
}
</script>

<template>
  <div
    class="group flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 cursor-pointer transition-colors select-none"
    :class="loading ? 'opacity-50' : ''"
    @click="emit('click')"
  >
    <!-- Complete / Reopen (left of title) -->
    <UTooltip v-if="isAiInProgress" text="Claude is working on this…">
      <UIcon name="i-lucide-loader-2" class="size-5 shrink-0 text-info animate-spin" />
    </UTooltip>
    <UButton
      v-else-if="task.status !== 'done'"
      icon="i-lucide-circle"
      color="neutral"
      variant="ghost"
      size="sm"
      class="opacity-30 group-hover:opacity-100 group-hover:text-success transition-opacity shrink-0"
      aria-label="Mark done"
      @click.stop="emit('mark-done')"
    />
    <UButton
      v-else
      icon="i-lucide-check-circle-2"
      color="success"
      variant="ghost"
      size="sm"
      class="opacity-60 group-hover:opacity-100 transition-opacity shrink-0"
      aria-label="Re-open task"
      @click.stop="emit('reopen')"
    />

    <!-- Status icon (optional) -->
    <UTooltip
      v-if="showStatus && status"
      :text="status.label"
    >
      <UIcon
        :name="status.icon"
        class="size-4 shrink-0"
        :class="`text-${status.color}`"
      />
    </UTooltip>

    <!-- Title -->
    <span class="flex-1 text-sm truncate" :class="task.status === 'done' ? 'line-through text-muted' : ''">{{ task.title }}</span>

    <!-- Right-side metadata -->
    <div class="flex items-center gap-1.5 shrink-0">
      <template v-if="isDone">
        <!-- Completed: date + assignees only -->
        <span v-if="completedLabel" class="text-xs text-muted hidden sm:block shrink-0">{{ completedLabel }}</span>
        <div v-if="assignees.length" class="hidden md:flex -space-x-1">
          <UTooltip v-for="a in assignees.slice(0, 2)" :key="a" :text="a">
            <UAvatar :alt="a" size="2xs" />
          </UTooltip>
          <UAvatar v-if="assignees.length > 2" :alt="`+${assignees.length - 2}`" size="2xs" />
        </div>
      </template>
      <template v-else>
        <!-- Active: due + priority + github refs + assignees + deps -->
        <span
          v-if="dueInfo"
          class="text-xs hidden sm:block shrink-0 tabular-nums"
          :class="dueInfo.isOverdue ? 'text-error font-medium' : dueInfo.isDueSoon ? 'text-warning' : 'text-muted'"
        >{{ dueInfo.label }}</span>
        <UBadge
          v-if="priority"
          :label="priority.label"
          :color="priority.color"
          :icon="priority.icon"
          variant="subtle"
          size="sm"
        />
        <template v-for="n in githubIssues.slice(0, 2)" :key="`i-${n}`">
          <a
            v-if="issueUrl(n)"
            :href="issueUrl(n)!"
            target="_blank"
            rel="noopener noreferrer"
            class="hidden sm:flex items-center gap-0.5 text-xs text-muted hover:text-primary transition-colors shrink-0"
            @click.stop
          >
            <UIcon name="i-lucide-circle-dot" class="size-3 shrink-0" />
            #{{ n }}
          </a>
          <span v-else class="hidden sm:flex items-center gap-0.5 text-xs text-muted shrink-0">
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
            class="hidden sm:flex items-center gap-0.5 text-xs text-muted hover:text-primary transition-colors shrink-0"
            @click.stop
          >
            <UIcon name="i-lucide-git-pull-request" class="size-3 shrink-0" />
            #{{ n }}
          </a>
          <span v-else class="hidden sm:flex items-center gap-0.5 text-xs text-muted shrink-0">
            <UIcon name="i-lucide-git-pull-request" class="size-3 shrink-0" />
            #{{ n }}
          </span>
        </template>
        <div v-if="assignees.length" class="hidden md:flex -space-x-1">
          <UTooltip v-for="a in assignees.slice(0, 2)" :key="a" :text="a">
            <UAvatar :alt="a" size="2xs" />
          </UTooltip>
          <UAvatar v-if="assignees.length > 2" :alt="`+${assignees.length - 2}`" size="2xs" />
        </div>
        <UIcon
          v-if="depCount"
          name="i-lucide-git-branch"
          class="size-3 text-muted shrink-0 hidden sm:block"
          :title="`${depCount} dependenc${depCount === 1 ? 'y' : 'ies'}`"
        />
      </template>

      <!-- Delete (always visible on hover) -->
      <UButton
        icon="i-lucide-trash-2"
        color="error"
        variant="ghost"
        size="sm"
        class="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0"
        aria-label="Delete task"
        @click.stop="emit('delete')"
      />
    </div>
  </div>
</template>
