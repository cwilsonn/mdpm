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

const {
  dueInfo, tags, depCount, priority, isDone,
  completedLabel,
} = useTaskCard(() => props.task)
</script>

<template>
  <UCard
    :ui="{ root: 'group cursor-pointer select-none transition-all hover:shadow-sm shrink-0', body: 'px-2.5! py-2! flex flex-col gap-1.5' }"
    :class="loading ? 'opacity-60' : ''"
    @click="emit('click')"
  >
    <!-- Title + actions -->
    <div class="flex items-start gap-1.5">
      <!-- The card is clickable as a whole for the mouse; this button is how the keyboard and screen readers open it. -->
      <button
        type="button"
        class="flex-1 text-left text-sm font-medium leading-snug rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        @click.stop="emit('click')"
      >
        {{ task.title }}
      </button>
      <UButton
        icon="i-lucide-trash-2"
        color="error"
        variant="ghost"
        size="xs"
        class="opacity-0 group-hover:opacity-60 group-focus-within:opacity-60 hover:!opacity-100 focus-visible:!opacity-100 transition-opacity shrink-0 -mt-0.5"
        aria-label="Delete task"
        @click.stop="emit('delete')"
      />
      <UButton
        v-if="task.status !== 'done'"
        icon="i-lucide-circle"
        color="neutral"
        variant="ghost"
        size="xs"
        class="opacity-30 group-hover:opacity-100 group-hover:text-success focus-visible:opacity-100 transition-opacity shrink-0 -mt-0.5 -mr-1"
        aria-label="Mark done"
        @click.stop="emit('mark-done')"
      />
      <UButton
        v-else
        icon="i-lucide-check-circle-2"
        color="success"
        variant="ghost"
        size="xs"
        class="opacity-60 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity shrink-0 -mt-0.5 -mr-1"
        aria-label="Re-open task"
        @click.stop="emit('reopen')"
      />
    </div>

    <!-- Done: completedAt only -->
    <template v-if="isDone">
      <span v-if="completedLabel" class="text-xs text-muted">Completed {{ completedLabel }}</span>
    </template>

    <!-- Active: priority + due + tags + deps -->
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
      <div v-if="depCount" class="flex items-center">
        <span
          v-if="depCount"
          class="flex items-center gap-0.5 text-xs"
          :class="hasBlockingDeps ? 'text-error' : 'text-muted'"
          :title="hasBlockingDeps ? 'Unresolved dependencies' : 'All dependencies resolved'"
        >
          <UIcon name="i-lucide-git-branch" class="size-3.5 shrink-0" />
          {{ depCount }}
          <span class="sr-only">{{ depCount === 1 ? 'dependency' : 'dependencies' }}, {{ hasBlockingDeps ? 'unresolved' : 'all resolved' }}</span>
        </span>
      </div>
    </template>
  </UCard>
</template>
