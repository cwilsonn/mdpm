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

const {
  dueInfo, depCount, status, priority, isDone,
  completedLabel,
} = useTaskCard(() => props.task)
</script>

<template>
  <div
    class="group flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 cursor-pointer transition-colors select-none"
    :class="loading ? 'opacity-50' : ''"
    @click="emit('click')"
  >
    <!-- Complete / Reopen (left of title) -->
    <UButton
      v-if="task.status !== 'done'"
      icon="i-lucide-circle"
      color="neutral"
      variant="ghost"
      size="sm"
      class="opacity-30 group-hover:opacity-100 group-hover:text-success focus-visible:opacity-100 transition-opacity shrink-0"
      aria-label="Mark done"
      @click.stop="emit('mark-done')"
    />
    <UButton
      v-else
      icon="i-lucide-check-circle-2"
      color="success"
      variant="ghost"
      size="sm"
      class="opacity-60 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity shrink-0"
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
    <span v-if="showStatus && status" class="sr-only">{{ status.label }}:</span>

    <!-- Title: the row is clickable as a whole for the mouse; this button is the keyboard and screen reader way in. -->
    <button
      type="button"
      class="flex-1 min-w-0 text-left text-sm truncate rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      :class="task.status === 'done' ? 'line-through text-muted' : ''"
      @click.stop="emit('click')"
    >
      {{ task.title }}
    </button>

    <!-- Right-side metadata -->
    <div class="flex items-center gap-1.5 shrink-0">
      <template v-if="isDone">
        <!-- Completed: date only -->
        <span v-if="completedLabel" class="text-xs text-muted hidden sm:block shrink-0">{{ completedLabel }}</span>
      </template>
      <template v-else>
        <!-- Active: due + priority + deps -->
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
        <UIcon
          v-if="depCount"
          name="i-lucide-git-branch"
          class="size-3 text-muted shrink-0 hidden sm:block"
          :title="`${depCount} dependenc${depCount === 1 ? 'y' : 'ies'}`"
        />
        <span v-if="depCount" class="sr-only">{{ depCount }} dependenc{{ depCount === 1 ? 'y' : 'ies' }}</span>
      </template>

      <!-- Delete (always visible on hover) -->
      <UButton
        icon="i-lucide-trash-2"
        color="error"
        variant="ghost"
        size="sm"
        class="opacity-0 group-hover:opacity-60 group-focus-within:opacity-60 hover:!opacity-100 focus-visible:!opacity-100 transition-opacity shrink-0"
        aria-label="Delete task"
        @click.stop="emit('delete')"
      />
    </div>
  </div>
</template>
