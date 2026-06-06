<script setup lang="ts">
export interface TaskCardData {
  path: string
  title: string
  status: string
  priority: string
  tags?: string[]
  assignees?: string[]
  due?: string
  dependencies?: string[]
  [key: string]: unknown
}

const props = defineProps<{
  task: TaskCardData
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
const tags = computed(() => (props.task.tags as string[] | undefined) ?? [])
const assignees = computed(() => (props.task.assignees as string[] | undefined) ?? [])
const depCount = computed(() => (props.task.dependencies as string[] | undefined)?.length ?? 0)
const priority = computed(() => PRIORITY_MAP[props.task.priority])
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
      <UButton
        v-if="task.status !== 'done'"
        icon="i-lucide-circle"
        color="neutral"
        variant="ghost"
        size="xs"
        class="opacity-30 group-hover:opacity-100 group-hover:text-success transition-opacity shrink-0 -mt-0.5 -mr-1"
        title="Mark done"
        @click.stop="emit('mark-done')"
      />
      <UButton
        v-else
        icon="i-lucide-check-circle-2"
        color="success"
        variant="ghost"
        size="xs"
        class="opacity-60 group-hover:opacity-100 transition-opacity shrink-0 -mt-0.5 -mr-1"
        title="Re-open"
        @click.stop="emit('reopen')"
      />
    </div>

    <!-- Priority + due + tags -->
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

    <!-- Dep indicator + assignees -->
    <div
      v-if="depCount || assignees.length"
      class="flex items-center"
    >
      <span
        v-if="depCount"
        class="flex items-center gap-0.5 text-xs"
        :class="hasBlockingDeps ? 'text-error' : 'text-muted'"
        :title="hasBlockingDeps ? 'Unresolved dependencies' : 'All dependencies resolved'"
      >
        <UIcon name="i-lucide-git-branch" class="size-3.5 shrink-0" />
        {{ depCount }}
      </span>
      <div
        v-if="assignees.length"
        class="flex -space-x-1 ml-auto"
      >
        <UTooltip
          v-for="a in assignees.slice(0, 3)"
          :key="a"
          :text="a"
        >
          <UAvatar :alt="a" size="2xs" />
        </UTooltip>
        <UAvatar
          v-if="assignees.length > 3"
          :alt="`+${assignees.length - 3}`"
          size="2xs"
        />
      </div>
    </div>
  </UCard>
</template>
