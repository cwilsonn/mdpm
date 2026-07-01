<script setup lang="ts">
import { VueDraggable } from 'vue-draggable-plus'

const props = defineProps<{
  columns: Record<string, Task[]>
  visibleColumns: StatusCfg[]
  projectSlug: string
  loadingPath?: string | null
  pending?: boolean
}>()

const emit = defineEmits<{
  'task-click': [task: Task]
  'add-task': [colId: string]
  'mark-done': [tSlug: string]
  reopen: [tSlug: string]
  delete: [tSlug: string]
  refresh: []
}>()

const isDragging = ref(false)
const { updating, persistOrder: persistReorder, moveTask } = useReorder()
const { withErrorToast } = useApiToast()

function persistOrder() {
  return persistReorder(props.projectSlug, props.columns)
}

const tasksBySlug = computed(() => {
  const map: Record<string, Task> = {}
  for (const col of STATUS_CONFIG) {
    for (const t of (props.columns[col.id] ?? [])) map[slugFromPath(t.path)] = t
  }
  return map
})

function hasBlockingDeps(task: Task) {
  return task.dependencies?.some(
    dep => tasksBySlug.value[dep]?.status !== 'done',
  ) ?? false
}

async function onColumnAdd(colId: string, evt: { newIndex?: number }) {
  const task = props.columns[colId]?.[evt.newIndex ?? 0]
  if (!task) return
  const tSlug = slugFromPath(task.path)
  task.status = colId
  updating.value = task.path
  try {
    await withErrorToast(async () => {
      await moveTask(props.projectSlug, tSlug, colId)
      await persistOrder()
    }, 'Failed to move task')
  }
  catch {}
  finally {
    emit('refresh')
    updating.value = null
  }
}

async function onColumnUpdate() {
  try {
    await withErrorToast(() => persistOrder(), 'Failed to save order')
  }
  catch {}
  finally {
    emit('refresh')
  }
}
</script>

<template>
  <div
    class="flex gap-3 overflow-x-auto flex-1 min-h-0"
    :class="pending ? 'opacity-50 pointer-events-none' : 'transition-opacity'"
  >
    <div
      v-for="col in visibleColumns"
      :key="col.id"
      class="flex flex-col flex-none w-64 sm:w-72 min-h-0"
    >
      <div class="flex items-center gap-2 mb-2 px-1">
        <UIcon
          :name="col.icon"
          class="size-4 shrink-0"
          :class="`text-${col.color}`"
        />
        <span class="text-sm font-medium">{{ col.label }}</span>
        <UBadge
          :label="String((columns[col.id] ?? []).length)"
          color="neutral"
          variant="subtle"
          size="sm"
        />
        <UButton
          label="Add"
          icon="i-lucide-plus"
          color="neutral"
          variant="ghost"
          size="sm"
          class="ml-auto"
          @click="emit('add-task', col.id)"
        />
      </div>

      <VueDraggable
        v-model="columns[col.id]!"
        :group="{ name: 'tasks', pull: true, put: true }"
        :animation="150"
        class="flex flex-col gap-2 flex-1 rounded-xl p-2 bg-muted min-h-24 overflow-y-auto"
        ghost-class="opacity-40"
        filter=".drag-ignore"
        @start="isDragging = true"
        @end="isDragging = false"
        @add="(e) => onColumnAdd(col.id, e)"
        @update="onColumnUpdate"
      >
        <button
          v-if="!(columns[col.id] ?? []).length && !isDragging"
          type="button"
          class="drag-ignore group flex items-center justify-center flex-1 min-h-16 rounded-lg cursor-pointer transition-colors hover:bg-elevated/60"
          @click="emit('add-task', col.id)"
        >
          <div class="flex items-center gap-1.5 text-xs text-muted opacity-0 group-hover:opacity-100 transition-opacity">
            <UIcon name="i-lucide-plus" class="size-3.5 shrink-0" />
            Add task
          </div>
        </button>
        <TaskDisplayCard
          v-for="task in (columns[col.id] ?? [])"
          :key="task.path"
          :task="task"
          :has-blocking-deps="hasBlockingDeps(task)"
          :loading="updating === task.path || loadingPath === task.path"
          @click="emit('task-click', task)"
          @mark-done="emit('mark-done', slugFromPath(task.path))"
          @reopen="emit('reopen', slugFromPath(task.path))"
          @delete="emit('delete', slugFromPath(task.path))"
        />
      </VueDraggable>
    </div>
  </div>
</template>
