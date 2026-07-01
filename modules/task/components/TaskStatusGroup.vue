<script setup lang="ts">
const tasks = defineModel<Task[]>({ required: true })

const props = withDefaults(defineProps<{
  statusCfg: StatusCfg
  group: string
  isOpen: boolean
  isDragging: boolean
  sort?: boolean
  muted?: boolean
  showAddButton?: boolean
  loadingPath?: string | null
}>(), {
  sort: true,
  muted: false,
  showAddButton: false,
  loadingPath: null,
})

const emit = defineEmits<{
  toggle: []
  'drag-start': []
  'drag-end': []
  'drag-add': [evt: { newIndex?: number }]
  'drag-update': []
  'add-task': []
  'task-click': [task: Task]
  'mark-done': [task: Task]
  reopen: [task: Task]
  delete: [task: Task]
}>()
</script>

<template>
  <button
    class="flex items-center gap-1.5 w-full px-4 py-2.5 transition-colors text-left border-b border-default"
    :class="muted ? 'bg-muted hover:bg-elevated' : 'hover:bg-muted/50'"
    @click="emit('toggle')"
  >
    <UIcon
      name="i-lucide-chevron-right"
      class="size-3.5 shrink-0 transition-transform duration-150"
      :class="isOpen ? 'rotate-90' : ''"
    />
    <UIcon
      :name="statusCfg.icon"
      :class="`text-${statusCfg.color}`"
      class="size-3.5 shrink-0"
    />
    <span class="text-sm font-medium" :class="muted ? 'text-muted' : ''">{{ statusCfg.label }}</span>
    <UBadge
      :label="String(tasks.length)"
      color="neutral"
      variant="subtle"
      size="sm"
    />
    <UButton
      v-if="showAddButton"
      trailing-icon="i-lucide-plus"
      label="Add"
      color="neutral"
      variant="ghost"
      size="sm"
      class="ml-auto"
      :tooltip="{ text: `Add ${statusCfg.label} task` }"
      @click.stop="emit('add-task')"
    />
  </button>

  <AppDragList
    v-if="isOpen"
    v-model="tasks"
    :group="group"
    :sort="sort"
    class="divide-y divide-default/50 min-h-[2rem]"
    @drag-start="emit('drag-start')"
    @drag-end="emit('drag-end')"
    @drag-add="(e) => emit('drag-add', e)"
    @drag-update="emit('drag-update')"
  >
    <div
      v-if="!tasks.length && !isDragging"
      class="drag-ignore px-4 py-2.5 text-xs text-muted italic text-center"
    >
      No tasks
    </div>
    <TaskDisplayLine
      v-for="task in tasks"
      :key="task.path"
      :task="task"
      :loading="loadingPath === task.path"
      @click="emit('task-click', task)"
      @mark-done="emit('mark-done', task)"
      @reopen="emit('reopen', task)"
      @delete="emit('delete', task)"
    />
  </AppDragList>
  <div
    v-else
    class="border-b border-default"
    :class="isDragging ? 'min-h-[2rem]' : ''"
    @dragenter.prevent="emit('toggle')"
    @dragover.prevent
  />
</template>
