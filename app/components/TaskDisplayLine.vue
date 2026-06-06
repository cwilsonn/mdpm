<script setup lang="ts">
import type { TaskCardData } from './TaskDisplayCard.vue'

export type { TaskCardData }

const props = defineProps<{
  task: TaskCardData
  showStatus?: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  click: []
  'mark-done': []
}>()

const dueInfo = computed(() => props.task.due ? formatDueDate(props.task.due) : null)
const assignees = computed(() => (props.task.assignees as string[] | undefined) ?? [])
const depCount = computed(() => (props.task.dependencies as string[] | undefined)?.length ?? 0)
const status = computed(() => STATUS_MAP[props.task.status])
const priority = computed(() => PRIORITY_MAP[props.task.priority])
</script>

<template>
  <div
    class="group flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 cursor-pointer transition-colors select-none"
    :class="loading ? 'opacity-50' : ''"
    @click="emit('click')"
  >
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
    <span class="flex-1 text-sm truncate">{{ task.title }}</span>

    <!-- Right-side metadata -->
    <div class="flex items-center gap-1.5 shrink-0">
      <!-- Due date -->
      <span
        v-if="dueInfo"
        class="text-xs hidden sm:block shrink-0 tabular-nums"
        :class="dueInfo.isOverdue ? 'text-error font-medium' : dueInfo.isDueSoon ? 'text-warning' : 'text-muted'"
      >{{ dueInfo.label }}</span>

      <!-- Priority -->
      <UBadge
        v-if="priority"
        :label="priority.label"
        :color="priority.color"
        :icon="priority.icon"
        variant="subtle"
        size="sm"
      />

      <!-- Assignees -->
      <div
        v-if="assignees.length"
        class="hidden md:flex -space-x-1"
      >
        <UTooltip
          v-for="a in assignees.slice(0, 2)"
          :key="a"
          :text="a"
        >
          <UAvatar :alt="a" size="2xs" />
        </UTooltip>
        <UAvatar
          v-if="assignees.length > 2"
          :alt="`+${assignees.length - 2}`"
          size="2xs"
        />
      </div>

      <!-- Dep indicator -->
      <UIcon
        v-if="depCount"
        name="i-lucide-git-branch"
        class="size-3 text-muted shrink-0 hidden sm:block"
        :title="`${depCount} dependenc${depCount === 1 ? 'y' : 'ies'}`"
      />

      <!-- Mark done -->
      <UButton
        v-if="task.status !== 'done'"
        icon="i-lucide-check"
        color="success"
        variant="ghost"
        size="sm"
        class="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        title="Mark done"
        @click.stop="emit('mark-done')"
      />
    </div>
  </div>
</template>
