<script setup lang="ts">
import { VueDraggable } from 'vue-draggable-plus'

const route = useRoute()
const slug = computed(() => route.params.slug as string)

const { data: project, refresh: refreshProject } = await useAsyncData(
  () => `project-${slug.value}`,
  () => queryCollection('projects')
    .where('path', '=', `/projects/${slug.value}`)
    .first(),
)

if (!project.value) {
  throw createError({ statusCode: 404, message: 'Project not found' })
}

const { data: tasks, refresh: refreshTasks } = await useAsyncData(
  () => `tasks-${slug.value}`,
  () => queryCollection('tasks')
    .where('path', 'LIKE', `/projects/${slug.value}/tasks/%`)
    .order('order', 'ASC')
    .all(),
)

type ColId = StatusId
type Task = NonNullable<typeof tasks.value>[0]

interface SelectItem { label: string; value: string; icon?: string; color?: string; avatar?: { alt: string } }

const searchQuery = ref('')
const filterStatuses = ref<SelectItem[]>([])   // empty = all columns visible
const filterPriorities = ref<SelectItem[]>([]) // empty = all priorities
const filterAssignees = ref<SelectItem[]>([])  // empty = all assignees

const allAssignees = computed(() => getAssigneeNames((tasks.value ?? []) as Array<{ assignees?: string[] }>))

const assigneeFilterItems = computed<SelectItem[]>(() =>
  allAssignees.value.map(name => ({ label: name, value: name, avatar: { alt: name } })),
)

const visibleColumns = computed(() =>
  filterStatuses.value.length === 0
    ? STATUS_CONFIG
    : STATUS_CONFIG.filter(s => filterStatuses.value.some(f => f.value === s.id)),
)

// Per-column arrays — VueDraggable v-model targets
const columns = reactive<Record<ColId, Task[]>>({
  'todo': [],
  'in-progress': [],
  'in-review': [],
  'blocked': [],
  'done': [],
})

function syncColumns(v: typeof tasks.value) {
  const q = searchQuery.value.trim().toLowerCase()
  const all = (v ?? []).map(t => ({ ...t }))
  for (const col of STATUS_CONFIG) {
    columns[col.id] = all.filter(
      t => t.status === col.id
        && (filterPriorities.value.length === 0 || filterPriorities.value.some(p => p.value === t.priority))
        && (filterAssignees.value.length === 0 || filterAssignees.value.some(a => (t as any).assignees?.includes(a.value)))
        && (!q || t.title.toLowerCase().includes(q)),
    )
  }
}

watch(tasks, syncColumns, { immediate: true })
watch(filterPriorities, () => syncColumns(tasks.value), { deep: true })
watch(filterAssignees, () => syncColumns(tasks.value), { deep: true })
watch(searchQuery, () => syncColumns(tasks.value))

// Mark done
const { markingDone, markDone: _markDone } = useMarkDone()

async function markTaskDone(tSlug: string) {
  await _markDone(slug.value, `/projects/${slug.value}/tasks/${tSlug}`, refreshTasks)
}

const totalVisible = computed(() => visibleColumns.value.reduce((s, c) => s + columns[c.id].length, 0))

const tasksBySlug = computed(() => {
  const map: Record<string, Task> = {}
  for (const col of STATUS_CONFIG) {
    for (const t of columns[col.id]) map[slugFromPath(t.path)] = t
  }
  return map
})

function hasBlockingDeps(task: Task) {
  return (task as any).dependencies?.some(
    (dep: string) => tasksBySlug.value[dep]?.status !== 'done',
  ) ?? false
}

const updating = ref<string | null>(null)

async function persistOrder() {
  const order: Record<string, string[]> = {}
  for (const col of STATUS_CONFIG) {
    order[col.id] = columns[col.id].map(t => slugFromPath(t.path))
  }
  await $fetch('/api/tasks/reorder', {
    method: 'POST',
    body: { project: slug.value, order },
  })
}

async function onColumnAdd(colId: ColId, evt: { newIndex: number }) {
  const task = columns[colId][evt.newIndex]
  if (!task) return
  const tSlug = slugFromPath(task.path)
  task.status = colId
  updating.value = task.path
  try {
    await $fetch(`/api/tasks/${slug.value}/${tSlug}`, {
      method: 'PATCH',
      body: { status: colId },
    })
    await persistOrder()
    await refreshTasks()
  }
  catch {
    await refreshTasks()
  }
  finally {
    updating.value = null
  }
}

async function onColumnUpdate() {
  try {
    await persistOrder()
    await refreshTasks()
  }
  catch {
    await refreshTasks()
  }
}

const showCreateTask = ref(false)
const createTaskStatus = ref<ColId>('todo')
const showEditProject = ref(false)
const editTask = ref<Task | null>(null)

function openCreateTask(status: ColId = 'todo') {
  createTaskStatus.value = status
  showCreateTask.value = true
}

const taskToDelete = ref<string | null>(null)
const deleting = ref(false)

function confirmDeleteTask(tSlug: string) {
  taskToDelete.value = tSlug
}

async function deleteTask() {
  if (!taskToDelete.value) return
  deleting.value = true
  try {
    await $fetch(`/api/tasks/${slug.value}/${taskToDelete.value}`, { method: 'DELETE' })
    await refreshTasks()
    taskToDelete.value = null
  }
  finally {
    deleting.value = false
  }
}


useHead(() => ({ title: project.value?.title ?? slug.value }))

const breadcrumb = computed(() => [
  { label: 'Projects', to: '/projects', icon: 'i-lucide-folder' },
  { label: project.value?.title ?? slug.value, icon: (project.value as any)?.icon || undefined },
])
</script>

<template>
  <AppPageBase :breadcrumb="breadcrumb">
    <template #actions>
      <UButton
        label="Edit Project"
        icon="i-lucide-pencil"
        color="neutral"
        variant="outline"
        size="sm"
        @click="showEditProject = true"
      />
      <UButton
        label="New Task"
        icon="i-lucide-plus"
        size="sm"
        @click="openCreateTask()"
      />
    </template>

    <div class="flex flex-col h-full">
      <!-- Project meta + filters -->
      <div class="px-4 sm:px-6 pt-4 sm:pt-6 pb-3 space-y-3 shrink-0">
        <div class="flex items-center gap-2 flex-wrap">
          <UBadge
            :label="project!.status"
            :color="PROJECT_STATUS_MAP[project!.status]?.color ?? 'neutral'"
            variant="subtle"
          />
          <UBadge
            v-for="tag in project!.tags"
            :key="tag"
            :label="tag"
            color="neutral"
            variant="outline"
            size="sm"
          />
        </div>

        <p
          v-if="project!.description"
          class="text-sm text-muted"
        >
          {{ project!.description }}
        </p>

        <div class="flex items-center gap-2 flex-wrap">
          <UInput
            v-model="searchQuery"
            placeholder="Search…"
            icon="i-lucide-search"
            size="sm"
            class="w-36"
          />
          <AppFilterMenu
            v-model="filterStatuses"
            :items="(STATUS_SELECT_ITEMS as SelectItem[])"
            placeholder="Columns"
          />
          <AppFilterMenu
            v-model="filterPriorities"
            :items="(PRIORITY_SELECT_ITEMS as SelectItem[])"
            placeholder="Priority"
          />
          <AppFilterMenu
            v-if="allAssignees.length"
            v-model="filterAssignees"
            :items="assigneeFilterItems"
            placeholder="Assignees"
          />
          <span class="text-xs text-muted ml-auto">
            {{ totalVisible }} task{{ totalVisible !== 1 ? 's' : '' }}
          </span>
        </div>
      </div>

      <!-- Kanban board -->
      <div class="flex gap-3 overflow-x-auto px-4 sm:px-6 pb-6 flex-1 min-h-0">
        <div
          v-for="col in visibleColumns"
          :key="col.id"
          class="flex flex-col flex-none w-72 min-h-0"
        >
          <!-- Column header -->
          <div class="flex items-center gap-2 mb-2 px-1">
            <UIcon
              :name="col.icon"
              class="size-4 shrink-0"
              :class="`text-${col.color}`"
            />
            <span class="text-sm font-medium">{{ col.label }}</span>
            <UBadge
              :label="String(columns[col.id].length)"
              color="neutral"
              variant="subtle"
              size="xs"
            />
            <UButton
              icon="i-lucide-plus"
              color="neutral"
              variant="ghost"
              size="xs"
              class="ml-auto"
              :tooltip="{ text: `Add ${col.label} task` }"
              @click="openCreateTask(col.id)"
            />
          </div>

          <!-- Draggable column -->
          <VueDraggable
            v-model="columns[col.id]"
            :group="{ name: 'tasks', pull: true, put: true }"
            :animation="150"
            class="flex flex-col gap-2 flex-1 rounded-xl p-2 bg-muted min-h-24 overflow-y-auto"
            ghost-class="opacity-40"
            @add="(e) => onColumnAdd(col.id, e)"
            @update="onColumnUpdate"
          >
            <TaskDisplayCard
              v-for="task in columns[col.id]"
              :key="task.path"
              :task="task"
              :has-blocking-deps="hasBlockingDeps(task)"
              :loading="updating === task.path || markingDone === task.path"
              @click="editTask = task"
              @mark-done="markTaskDone(slugFromPath(task.path))"
              @delete="confirmDeleteTask(slugFromPath(task.path))"
            />
          </VueDraggable>
        </div>
      </div>
    </div>

    <template #overlays>
      <TaskForm
        v-if="editTask"
        :project-slug="slug"
        :task="editTask"
        @close="() => { editTask = null; refreshTasks() }"
      />
      <TaskForm
        v-else-if="showCreateTask"
        :project-slug="slug"
        :initial-status="createTaskStatus"
        @close="showCreateTask = false"
        @saved="() => { showCreateTask = false; refreshTasks() }"
      />
      <ProjectForm
        v-if="showEditProject"
        :project="project!"
        @close="() => { showEditProject = false; refreshProject() }"
      />
      <AppConfirmDialog
        :open="!!taskToDelete"
        title="Delete task?"
        message="This cannot be undone."
        confirm-label="Delete"
        :loading="deleting"
        @update:open="taskToDelete = null"
        @confirm="deleteTask"
        @cancel="taskToDelete = null"
      />
    </template>
  </AppPageBase>
</template>
